// Вкладка «Команда» (PRD §18, решения Артёма 18.08.2026): справочник коллектива — кто у нас
// работает, у кого когда день рождения и кто когда в отпуске.
//
// Два вида людей в одном списке и почему так:
//  · учётки с доступом (админ, диспетчер, водители, менеджер-сервисник) — их заводят сидами, здесь
//    им можно проставить ТОЛЬКО день рождения. Имя, роль, доступы — это «Управление», и подменять
//    его отсюда нельзя: справочник коллег не должен уметь раздавать права.
//  · сотрудники БЕЗ доступа (role=EMPLOYEE, canLogin=false) — цеховые и прочие коллеги, которых
//    надо помнить. Их заводят прямо здесь, и здесь же правят целиком: кроме этого экрана, они
//    в системе нигде не участвуют.
//
// Кто правит справочник (21.08.2026): диспетчер, админ и менеджер-сервисник — белый список
// isTeamManagerRole в team-access.ts. Гейт стоит и в доменных функциях, а не только в route:
// экран общий, изоляции «по владельцу» у него нет, и проверка права — единственная защита записи.
//
// Внешний перевозчик (isExternal) в справочник не входит — он не коллега, а подрядчик.
// Удаления нет: сотрудника «убирают» деактивацией (isActive=false), потому что на нём могут висеть
// отпуска и (в будущем) задачи, а история в этом проекте не переписывается.
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { Errors } from "./errors";
import { dateKeyInTz } from "./kpi";
import { upcomingBirthdays, type UpcomingBirthday } from "./birthdays";
import { listAbsencesFrom, type AbsenceView } from "./absence-service";
import { assertTeamManager } from "./team-access";
import type { Role } from "@/generated/prisma/enums";

export type Actor = { id: string; role: Role };

/** Горизонт блока «Ближайшие дни рождения» на экране: два месяца вперёд. */
const BIRTHDAY_HORIZON_DAYS = 60;

const NAME_MAX = 120;
const POSITION_MAX = 120;
const PHONE_MAX = 60;
const BIRTHDAY_MIN = "1900-01-01";

export type TeamMemberView = {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
  role: Role;
  birthday: string | null; // YYYY-MM-DD
  /** Есть ли у человека вход в систему — для бейджа «без входа» и для правил правки. */
  canLogin: boolean;
  /** true — карточку можно править целиком (сотрудник без доступа заведён здесь же). */
  editable: boolean;
};

export type TeamSnapshot = {
  members: TeamMemberView[];
  /** Отпуска/больничные, которые ещё не закончились, — по всему коллективу. */
  absences: AbsenceView[];
  birthdays: UpcomingBirthday[];
  /** МСК-сегодня: клиент считает «идёт сейчас / запланирован» от той же даты, что и сервер. */
  today: string;
};

type MemberRow = {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
  role: Role;
  birthday: Date | null;
  canLogin: boolean;
};

// Логин и хэш пароля наружу не отдаём никогда — экран про людей, а не про учётные данные.
const MEMBER_SELECT = {
  id: true,
  name: true,
  position: true,
  phone: true,
  role: true,
  birthday: true,
  canLogin: true,
} as const;

function toView(u: MemberRow): TeamMemberView {
  return {
    id: u.id,
    name: u.name,
    position: u.position,
    phone: u.phone,
    role: u.role,
    birthday: u.birthday ? u.birthday.toISOString().slice(0, 10) : null,
    canLogin: u.canLogin,
    editable: u.role === "EMPLOYEE",
  };
}

/**
 * «YYYY-MM-DD» → Date (UTC-полночь, как @db.Date). Пустая строка/null → null (дату сняли).
 *
 * Верхняя граница — год вперёд, а не «сегодня»: год рождения в системе нигде не используется (везде
 * показываем и сравниваем только день с месяцем), и Милене должно хватать ввода «21.08» без года —
 * а он подставляет текущий, который для августовских дат уже «будущее». Поэтому запрещаем только
 * заведомую опечатку в годе (2126) и даты раньше 1900.
 */
function parseBirthday(value: string | null | undefined, todayKey: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Errors.validation("Некорректная дата рождения");
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    // Отсекает 31 февраля и прочие «даты», которые Date молча переносит на следующий месяц.
    throw Errors.validation("Некорректная дата рождения");
  }
  const maxKey = `${Number(todayKey.slice(0, 4)) + 1}${todayKey.slice(4)}`;
  if (value < BIRTHDAY_MIN || value > maxKey) {
    throw Errors.validation("Проверьте год в дате рождения");
  }
  return d;
}

function parseName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw Errors.validation("Укажите имя сотрудника");
  if (name.length > NAME_MAX) throw Errors.validation("Слишком длинное имя");
  return name;
}

function parseOptionalText(value: string | null | undefined, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw Errors.validation(`Слишком длинное поле «${label}»`);
  return text;
}

/** Снимок вкладки одним запросом: люди + их отпуска + ближайшие дни рождения. */
export async function getTeamSnapshot(): Promise<TeamSnapshot> {
  const today = dateKeyInTz(new Date());
  const [rows, absences] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, isExternal: false },
      select: MEMBER_SELECT,
      orderBy: { name: "asc" },
    }),
    listAbsencesFrom(today),
  ]);
  const members = rows.map(toView);
  return {
    members,
    absences,
    birthdays: upcomingBirthdays(members, today, BIRTHDAY_HORIZON_DAYS),
    today,
  };
}

/**
 * Завести сотрудника без доступа в систему. Роль и вход задаём здесь жёстко — из тела запроса они
 * не приходят вовсе, иначе справочник коллег стал бы способом создать себе учётку с правами.
 * Логин технический (человек им не пользуется), пароль случайный и никому не известен: даже если
 * когда-нибудь включат canLogin, войти по нему нельзя — админ сначала задаст пароль осознанно.
 */
export async function createEmployee(
  input: { name: string; position?: string | null; phone?: string | null; birthday?: string | null },
  actor: Actor,
): Promise<TeamMemberView> {
  assertTeamManager(actor); // личность создавшего не журналируется (справочник, не документ) — но право проверяем
  const today = dateKeyInTz(new Date());
  const name = parseName(input.name);
  const position = parseOptionalText(input.position, POSITION_MAX, "должность");
  const phone = parseOptionalText(input.phone, PHONE_MAX, "телефон");
  const birthday = parseBirthday(input.birthday, today);

  const created = await prisma.user.create({
    data: {
      login: `emp-${crypto.randomUUID()}`,
      passwordHash: await hashPassword(crypto.randomUUID()),
      name,
      position,
      phone,
      birthday,
      role: "EMPLOYEE",
      canLogin: false,
      isExternal: false,
    },
    select: MEMBER_SELECT,
  });
  return toView(created);
}

export type TeamMemberPatch = {
  name?: string;
  position?: string | null;
  phone?: string | null;
  birthday?: string | null;
};

/**
 * Правка карточки. У сотрудника без доступа — все поля; у учётки с доступом — ТОЛЬКО день рождения
 * (имя, должность и телефон там ведёт «Управление», и подменять его отсюда нельзя).
 * Роль, логин, вход и флаги доступа не принимаются в принципе — их нет в типе патча.
 */
export async function updateTeamMember(
  id: string,
  patch: TeamMemberPatch,
  actor: Actor,
): Promise<TeamMemberView> {
  assertTeamManager(actor);
  const today = dateKeyInTz(new Date());
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, isActive: true, isExternal: true },
  });
  // Несуществующего, уволенного и внешнего не подсвечиваем — для этого экрана их просто нет.
  if (!target || !target.isActive || target.isExternal) throw Errors.notFound();

  const wantsProfileFields =
    patch.name !== undefined || patch.position !== undefined || patch.phone !== undefined;
  if (target.role !== "EMPLOYEE" && wantsProfileFields) {
    throw Errors.validation(
      "У сотрудника с доступом в систему здесь меняется только день рождения — остальное в «Управлении»",
    );
  }

  const data: { name?: string; position?: string | null; phone?: string | null; birthday?: Date | null } = {};
  if (patch.name !== undefined) data.name = parseName(patch.name);
  if (patch.position !== undefined) data.position = parseOptionalText(patch.position, POSITION_MAX, "должность");
  if (patch.phone !== undefined) data.phone = parseOptionalText(patch.phone, PHONE_MAX, "телефон");
  if (patch.birthday !== undefined) data.birthday = parseBirthday(patch.birthday, today);
  if (Object.keys(data).length === 0) throw Errors.validation("Нечего менять");

  const updated = await prisma.user.update({ where: { id }, data, select: MEMBER_SELECT });
  return toView(updated);
}

/**
 * Убрать сотрудника из справочника — мягко, отметкой isActive=false: его отпуска остаются в базе,
 * а сам он пропадает из списков и из рассылки. Работает только для заведённых здесь (EMPLOYEE):
 * учётку с доступом отключают в «Управлении», где это осознанное действие с правами.
 */
export async function deactivateEmployee(id: string, actor: Actor): Promise<void> {
  assertTeamManager(actor);
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, isActive: true },
  });
  if (!target || !target.isActive || target.role !== "EMPLOYEE") throw Errors.notFound();
  await prisma.user.update({ where: { id }, data: { isActive: false } });
}

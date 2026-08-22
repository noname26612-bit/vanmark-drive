// Запросы по пользователям для экранов диспетчера.
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { DomainError, Errors } from "./errors";
import { assertPasswordStrength } from "./password-policy";
import type { DriverDTO } from "@/lib/task-dto";
import type { Role } from "./roles";

/** Активные водители для колонок доски и выбора исполнителя (включая внешних без входа).
 *  onPayroll = есть активный денежный профиль (штатный на окладе) — признак «работает каждый день»
 *  для блока «Смены водителей» (решение Артёма 24.06). isExternal — наёмный перевозчик (02.07):
 *  без смен, в форме заявки доступна стоимость поездки (этап 3). */
export async function listActiveDrivers(): Promise<DriverDTO[]> {
  const rows = await prisma.user.findMany({
    where: { role: "DRIVER", isActive: true },
    select: {
      id: true,
      name: true,
      canLogin: true,
      isExternal: true,
      payProfile: { select: { isActive: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    canLogin: u.canLogin,
    isExternal: u.isExternal,
    onPayroll: u.payProfile?.isActive ?? false,
  }));
}

/**
 * Исполнители задач сотрудникам (цех и снабжение, 15.08.2026) — все, кому открыт этот доступ.
 * Роль не фильтруем: сегодня это водители Александр с Николаем, завтра — сотрудники цеха, которых
 * заведут тем же флагом. Список отдаётся только тем, кто ставит задачи (guard в route).
 */
export async function listStaffPerformers(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { isActive: true, staffTasksAccess: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Есть ли у пользователя доступ к задачам сотрудникам. Признак из БД, никогда из сессии. */
export async function hasStaffTasksAccess(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { staffTasksAccess: true, isActive: true },
  });
  return (u?.isActive && u.staffTasksAccess) === true;
}

/** Внешний (наёмный) исполнитель? Признак из БД (User.isExternal), никогда из запроса. */
export async function isExternalDriver(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isExternal: true } });
  return u?.isExternal ?? false;
}

/**
 * Есть ли у пользователя персональный допуск к разделам оборудования (15.08.2026). Признак из БД,
 * никогда из запроса и никогда из сессии: доступ выдаётся и снимается в «Управлении», и должен
 * действовать сразу, а не после того, как истечёт тридцатидневная кука.
 */
export async function hasEquipmentAccess(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { equipmentAccess: true, isActive: true },
  });
  return (u?.isActive && u.equipmentAccess) === true;
}

/**
 * Роли, которыми управляет экран «Пользователи и доступ» (22.08.2026): все, у кого вход в систему
 * вообще возможен. EMPLOYEE сюда НЕ входит и не войдёт: сотрудник цеха заводится в «Команде» без
 * входа by design (PRD §18) — открыть ему доступ можно только осознанной сменой роли, а не кнопкой
 * в списке. Белый список, а не «все кроме EMPLOYEE»: следующая роль не должна пролезать сама.
 */
export const MANAGED_ROLES: readonly Role[] = ["ADMIN", "DISPATCHER", "SERVICE_MANAGER", "DRIVER"];

// Доступ пользователей для админ-экрана «Пользователи и доступ» (02.07 — водители, 22.08 — офис).
export type UserAccessView = {
  id: string;
  name: string;
  login: string;
  role: Role;
  position: string | null; // должность (Михаил-директор) — показывается бейджем рядом с ролью
  canLogin: boolean;
  isExternal: boolean;
  onPayroll: boolean;
  /** Персональный допуск к разделам оборудования (Листогибы/Фальцепрокатники), 15.08.2026. */
  equipmentAccess: boolean;
  /** Персональный допуск к задачам сотрудникам (цех/снабжение), 15.08.2026. */
  staffTasksAccess: boolean;
};

/**
 * Учётки, которыми управляет админ: офис (админ, диспетчер, менеджер-сервисник) и водители.
 * Только для админа (guard в route). Сотрудников без входа (EMPLOYEE) здесь нет.
 */
export async function listUserAccess(): Promise<UserAccessView[]> {
  const rows = await prisma.user.findMany({
    where: { role: { in: [...MANAGED_ROLES] }, isActive: true },
    select: ACCESS_SELECT,
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  return rows.map(toAccessView);
}

// Поля ответа админ-экрана — один select на все ручки доступа.
const ACCESS_SELECT = {
  id: true,
  name: true,
  login: true,
  role: true,
  position: true,
  canLogin: true,
  isExternal: true,
  equipmentAccess: true,
  staffTasksAccess: true,
  payProfile: { select: { isActive: true } },
} as const;

type AccessRow = {
  id: string;
  name: string;
  login: string;
  role: Role;
  position: string | null;
  canLogin: boolean;
  isExternal: boolean;
  equipmentAccess: boolean;
  staffTasksAccess: boolean;
  payProfile: { isActive: boolean } | null;
};

function toAccessView(u: AccessRow): UserAccessView {
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    role: u.role,
    position: u.position,
    canLogin: u.canLogin,
    isExternal: u.isExternal,
    onPayroll: u.payProfile?.isActive ?? false,
    equipmentAccess: u.equipmentAccess,
    staffTasksAccess: u.staffTasksAccess,
  };
}

/**
 * Найти водителя для действий, которые ТОЛЬКО про водителя: внешний перевозчик, доступ к
 * оборудованию, задачи сотрудникам. Чужая роль → 404 (не 403: не подсказываем, что пользователь
 * существует). Пароль и вход управляются шире — см. requireManagedUser.
 */
async function requireDriverUser(driverId: string): Promise<{ id: string; login: string }> {
  const user = await prisma.user.findUnique({
    where: { id: driverId },
    select: { id: true, role: true, login: true },
  });
  if (!user || user.role !== "DRIVER") throw Errors.notFound();
  return { id: user.id, login: user.login };
}

/**
 * Найти учётку, которой админ вправе управлять (пароль и вход): офис и водители (MANAGED_ROLES).
 * Сотрудник без входа (EMPLOYEE) и несуществующий id — одинаково 404: у первого доступа нет
 * by design, и различать их в ответе незачем.
 */
async function requireManagedUser(userId: string): Promise<{ id: string; login: string; role: Role }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, login: true, isActive: true },
  });
  if (!user || !user.isActive || !MANAGED_ROLES.includes(user.role)) throw Errors.notFound();
  return { id: user.id, login: user.login, role: user.role };
}

/**
 * Включить/выключить вход учётке (админ, осознанно — PRD §2: внешнему перевозчику вход включается
 * этой ручкой, пароль остаётся прежним из сида). С 22.08.2026 — не только водителю, но и офису.
 *
 * Два предохранителя, без которых системой можно закрыть самого себя:
 *   • СЕБЕ вход не выключают — иначе один клик выкидывает администратора из системы, и вернуть
 *     доступ будет некому (кнопка «Разрешить» живёт за админским входом);
 *   • ПОСЛЕДНЕГО активного админа со входом не выключают — тот же тупик, только в обход первого
 *     правила (два админа выключают друг друга по очереди).
 * Личность действующего берётся из сессии вызывающим (route), а не из тела запроса.
 */
export async function setUserLoginAccess(
  actorId: string,
  userId: string,
  canLogin: boolean,
): Promise<UserAccessView> {
  const target = await requireManagedUser(userId);
  if (!canLogin) {
    if (target.id === actorId) {
      throw Errors.validation("Нельзя закрыть вход самому себе — попросите другого администратора");
    }
    if (target.role === "ADMIN") {
      const admins = await prisma.user.count({
        where: { role: "ADMIN", isActive: true, canLogin: true, id: { not: target.id } },
      });
      if (admins === 0) {
        throw new DomainError(
          "LAST_ADMIN",
          "Это последний администратор со входом — сначала дайте вход другому",
          409,
        );
      }
    }
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { canLogin },
    select: ACCESS_SELECT,
  });
  return toAccessView(updated);
}

/**
 * Пометить водителя внешним перевозчиком (или вернуть в штат) — админ, 03.08. До этого признак
 * менялся только сидом или запросом к базе, поэтому завести второго внешнего перевозчика без
 * разработчика было нельзя. Признак меняет поведение: без смен (SHIFT_REQUIRED снят), вне KPI и
 * зарплаты, в заявке доступна стоимость поездки.
 */
export async function setDriverExternal(driverId: string, isExternal: boolean): Promise<UserAccessView> {
  await requireDriverUser(driverId);
  const updated = await prisma.user.update({
    where: { id: driverId },
    data: { isExternal },
    select: ACCESS_SELECT,
  });
  return toAccessView(updated);
}

/**
 * Выдать или снять водителю доступ к разделам оборудования (15.08.2026, Николай и Александр).
 * Роль остаётся DRIVER: задачи, смены и KPI считаются как раньше, меняется только видимость
 * «Листогибов» и «Фальцепрокатников». Как и остальные админ-действия — строго по роли DRIVER.
 */
export async function setDriverEquipmentAccess(
  driverId: string,
  equipmentAccess: boolean,
): Promise<UserAccessView> {
  await requireDriverUser(driverId);
  const updated = await prisma.user.update({
    where: { id: driverId },
    data: { equipmentAccess },
    select: ACCESS_SELECT,
  });
  return toAccessView(updated);
}

/**
 * Выдать или снять доступ к задачам сотрудникам (цех и снабжение, 15.08.2026). Это второй
 * персональный флаг после equipmentAccess: роль остаётся DRIVER — Александр с Николаем возят и
 * доставки, — а флаг решает, можно ли ставить им задачи по цеху и видят ли они их в телефоне.
 * Тем же флагом позже заведут сотрудников цеха, не трогая ролевую модель.
 */
export async function setDriverStaffTasksAccess(
  driverId: string,
  staffTasksAccess: boolean,
): Promise<UserAccessView> {
  await requireDriverUser(driverId);
  const updated = await prisma.user.update({
    where: { id: driverId },
    data: { staffTasksAccess },
    select: ACCESS_SELECT,
  });
  return toAccessView(updated);
}

/**
 * Задать пользователю новый пароль (админ-сброс, 03.08 — водителям, 22.08 — и офису): текущий
 * пароль не спрашиваем, это действие администратора, а не смена пароля пользователем. Пароль
 * приходит только в теле запроса, нигде не логируется и не возвращается в ответе; хранится
 * argon2id-хэшем.
 *
 * Известное ограничение: уже выданная сессия (JWT в куке) продолжает работать до истечения срока —
 * смена пароля её не выбивает. Для трёх сотрудников риск невелик; выбивание сессий потребовало бы
 * отдельного поля и миграции.
 */
export async function setUserPassword(userId: string, newPassword: string): Promise<UserAccessView> {
  const user = await requireManagedUser(userId);
  assertPasswordStrength(newPassword, user.login);
  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
    select: ACCESS_SELECT,
  });
  return toAccessView(updated);
}

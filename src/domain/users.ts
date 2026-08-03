// Запросы по пользователям для экранов диспетчера.
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { Errors } from "./errors";
import { assertPasswordStrength } from "./password-policy";
import type { DriverDTO } from "@/lib/task-dto";

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

/** Внешний (наёмный) исполнитель? Признак из БД (User.isExternal), никогда из запроса. */
export async function isExternalDriver(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isExternal: true } });
  return u?.isExternal ?? false;
}

// Доступ водителей для админ-экрана «Водители — доступ» (02.07): включить/выключить вход.
export type DriverAccessView = {
  id: string;
  name: string;
  login: string;
  canLogin: boolean;
  isExternal: boolean;
  onPayroll: boolean;
};

/** Список водителей с признаками доступа — только для админа (guard в route). */
export async function listDriverAccess(): Promise<DriverAccessView[]> {
  const rows = await prisma.user.findMany({
    where: { role: "DRIVER", isActive: true },
    select: {
      id: true,
      name: true,
      login: true,
      canLogin: true,
      isExternal: true,
      payProfile: { select: { isActive: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    login: u.login,
    canLogin: u.canLogin,
    isExternal: u.isExternal,
    onPayroll: u.payProfile?.isActive ?? false,
  }));
}

// Поля ответа админ-экрана — один select на все три ручки.
const ACCESS_SELECT = {
  id: true,
  name: true,
  login: true,
  canLogin: true,
  isExternal: true,
  payProfile: { select: { isActive: true } },
} as const;

type AccessRow = {
  id: string;
  name: string;
  login: string;
  canLogin: boolean;
  isExternal: boolean;
  payProfile: { isActive: boolean } | null;
};

function toAccessView(u: AccessRow): DriverAccessView {
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    canLogin: u.canLogin,
    isExternal: u.isExternal,
    onPayroll: u.payProfile?.isActive ?? false,
  };
}

/**
 * Найти водителя для админ-действий. Роль строго DRIVER: иначе через эти ручки можно было бы
 * сбросить пароль диспетчеру или админу — это захват учётки. Чужая роль → 404 (не 403: не
 * подсказываем, что такой пользователь существует).
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
 * Включить/выключить вход водителю (админ, осознанно — PRD §2: внешнему перевозчику вход включается
 * этой ручкой, пароль остаётся прежним из сида). Только роль DRIVER — диспетчера/админа не трогаем.
 */
export async function setDriverLoginAccess(driverId: string, canLogin: boolean): Promise<DriverAccessView> {
  await requireDriverUser(driverId);
  const updated = await prisma.user.update({
    where: { id: driverId },
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
export async function setDriverExternal(driverId: string, isExternal: boolean): Promise<DriverAccessView> {
  await requireDriverUser(driverId);
  const updated = await prisma.user.update({
    where: { id: driverId },
    data: { isExternal },
    select: ACCESS_SELECT,
  });
  return toAccessView(updated);
}

/**
 * Задать водителю новый пароль (админ-сброс, 03.08): текущий пароль не спрашиваем — это действие
 * администратора, а не смена пароля пользователем. Пароль приходит только в теле запроса, нигде
 * не логируется и не возвращается в ответе; хранится argon2id-хэшем.
 *
 * Известное ограничение: уже выданная сессия водителя (JWT в куке) продолжает работать до истечения
 * срока — смена пароля её не выбивает. Для трёх сотрудников риск невелик; выбивание сессий
 * потребовало бы отдельного поля и миграции.
 */
export async function setDriverPassword(driverId: string, newPassword: string): Promise<DriverAccessView> {
  const user = await requireDriverUser(driverId);
  assertPasswordStrength(newPassword, user.login);
  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: driverId },
    data: { passwordHash },
    select: ACCESS_SELECT,
  });
  return toAccessView(updated);
}

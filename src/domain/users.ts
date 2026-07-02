// Запросы по пользователям для экранов диспетчера.
import { prisma } from "@/lib/prisma";
import { Errors } from "./errors";
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

/**
 * Включить/выключить вход водителю (админ, осознанно — PRD §2: внешнему перевозчику вход включается
 * этой ручкой, пароль остаётся прежним из сида). Только роль DRIVER — диспетчера/админа не трогаем.
 */
export async function setDriverLoginAccess(driverId: string, canLogin: boolean): Promise<DriverAccessView> {
  const user = await prisma.user.findUnique({
    where: { id: driverId },
    select: { id: true, role: true },
  });
  if (!user || user.role !== "DRIVER") throw Errors.notFound();
  const updated = await prisma.user.update({
    where: { id: driverId },
    data: { canLogin },
    select: {
      id: true,
      name: true,
      login: true,
      canLogin: true,
      isExternal: true,
      payProfile: { select: { isActive: true } },
    },
  });
  return {
    id: updated.id,
    name: updated.name,
    login: updated.login,
    canLogin: updated.canLogin,
    isExternal: updated.isExternal,
    onPayroll: updated.payProfile?.isActive ?? false,
  };
}

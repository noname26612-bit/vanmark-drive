// Текст «Задания в цех» — единственный источник правды для предпросмотра в модалке (клиент)
// и для записи в журнал (сервер, событие kind=shop_task). Цех (Евгений/Фаха) вне системы:
// Максим отправляет этот текст в Telegram-группу «Задания в цех» руками — бота и интеграции нет
// осознанно (решение Артёма 07.08.2026; доступ цеха в систему — перспектива этапа 3, текст
// проектируется самодостаточным сообщением, чтобы потом лечь в экран цеха как есть).
//
// Дефектовка НЕ дублируется в отдельное поле: задание собирается из карточки в момент передачи.
import { utcDateKey } from "@/domain/kpi";
import { EQUIPMENT_KIND_LABEL } from "@/domain/machine-status";
import { machineTitle, formatDay } from "./machine-ui";
import type { EquipmentKind, MachineCategory } from "@/generated/prisma/enums";

export type ShopTaskMachine = {
  ourNumber: number | null;
  clientNumber: number | null;
  /** Номер станка читается по категории: «77-N» у своего парка, «К-N» у клиентского. */
  category: MachineCategory;
  invoice1C: string | null;
  kind: EquipmentKind;
  model: string;
  metalThickness: string | null;
  configuration: string | null;
  location: string | null;
  defectNotes: string | null;
  isUrgent: boolean;
  /** Date — с сервера (@db.Date), строка «YYYY-MM-DD» — из DTO на клиенте. */
  dueDate: Date | string | null;
};

/** Строки с пустыми значениями пропускаются — минимальная карточка даёт короткое задание без дыр. */
export function buildShopTaskText(m: ShopTaskMachine, note: string | null): string {
  const lines: string[] = [];
  if (m.isUrgent) lines.push("СРОЧНО!");
  lines.push(`В цех — ${machineTitle(m)}`);
  if (m.kind !== "MACHINE") lines.push(EQUIPMENT_KIND_LABEL[m.kind]);
  lines.push(`Модель: ${m.model}`);
  if (m.metalThickness?.trim()) lines.push(`Металл: ${m.metalThickness.trim()}`);
  if (m.configuration?.trim()) lines.push(`Комплектация: ${m.configuration.trim()}`);
  if (m.location?.trim()) lines.push(`Место: ${m.location.trim()}`);
  if (m.defectNotes?.trim()) lines.push(`Дефектовка: ${m.defectNotes.trim()}`);
  const noteTrimmed = note?.trim();
  if (noteTrimmed) lines.push(`Что сделать: ${noteTrimmed}`);
  if (m.dueDate !== null) {
    const dueKey = typeof m.dueDate === "string" ? m.dueDate : utcDateKey(m.dueDate);
    lines.push(`Срок: ${formatDay(dueKey)}`);
  }
  return lines.join("\n");
}

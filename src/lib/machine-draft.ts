// Тихий черновик формы заведения станка (решение Артёма 07.08.2026): закрыл модалку — ввод не
// пропал, при следующем открытии форма восстановлена. В отличие от черновиков заявок диспетчера
// (task-draft.ts, стек с чипами) здесь ОДИН черновик без UI-стека: Максим заводит один станок за
// раз, а плашка «Восстановлен черновик» с кнопкой «Начать заново» живёт прямо в форме.
//
// Фото в черновик не входят: File в localStorage не живёт; сохраняются только поля (PRD §16.5).
import { EquipmentFamily, EquipmentKind, MachineCategory } from "@/generated/prisma/enums";

// Ключ версионирован (образец DRAFTS_STORAGE_KEY у задач): поменяется структура — старый
// черновик просто не прочитается, а не уронит форму.
// Черновик свой у каждого раздела (15.08.2026): начатый листогиб не должен всплывать в форме
// фальцепрокатника — там другие виды и другая нумерация.
const KEY_PREFIX = "vanmark:machine-draft:v2:";
const keyFor = (family: EquipmentFamily): string => KEY_PREFIX + family;

export const EMPTY_MACHINE_FORM = {
  model: "",
  ourNumber: "",
  configuration: "",
  metalThickness: "",
  serialNumber: "",
  orgName: "",
  contactName: "",
  contactPhone: "",
  invoice1C: "",
  responsibleId: "",
  deliveredBy: "",
  arrivedAt: "",
  dueDate: "",
  defectNotes: "",
  location: "",
  notes: "",
  isUrgent: false,
};

export type MachineFormState = typeof EMPTY_MACHINE_FORM;

export type MachineDraft = {
  category: MachineCategory;
  kind: EquipmentKind;
  form: MachineFormState;
  savedAt: string; // ISO
};

/** Есть ли что терять: заполнено хоть одно поле (выбор категории/вида сам по себе не в счёт). */
export function isDirtyMachineForm(form: MachineFormState): boolean {
  return Object.values(form).some((v) => (typeof v === "string" ? v.trim() !== "" : v === true));
}

// Поля, спрятанные за «Показать все поля»: если в черновике заполнено хоть одно — форму
// разворачиваем сразу, чтобы восстановленные значения не оказались невидимыми.
const HIDDEN_KEYS = [
  "configuration",
  "metalThickness",
  "serialNumber",
  "orgName",
  "contactName",
  "contactPhone",
  "invoice1C",
  "responsibleId",
  "deliveredBy",
  "arrivedAt",
  "dueDate",
  "defectNotes",
  "location",
  "notes",
] as const;

export function hasHiddenFieldValues(form: MachineFormState): boolean {
  return HIDDEN_KEYS.some((k) => form[k].trim() !== "");
}

export function saveMachineDraft(family: EquipmentFamily, draft: Omit<MachineDraft, "savedAt">): void {
  try {
    const payload: MachineDraft = { ...draft, savedAt: new Date().toISOString() };
    localStorage.setItem(keyFor(family), JSON.stringify(payload));
  } catch {
    // приватный режим/переполненное хранилище — черновик не критичен, форму не роняем
  }
}

export function clearMachineDraft(family: EquipmentFamily): void {
  try {
    localStorage.removeItem(keyFor(family));
  } catch {
    // см. saveMachineDraft
  }
}

/** Прочитать черновик; битый/чужой формат → null (обоснованный unknown-парсинг localStorage). */
export function loadMachineDraft(family: EquipmentFamily): MachineDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(family));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (!p.form || typeof p.form !== "object") return null;

    const category = Object.values(MachineCategory).includes(p.category as MachineCategory)
      ? (p.category as MachineCategory)
      : "CLIENT";
    const kind = Object.values(EquipmentKind).includes(p.kind as EquipmentKind)
      ? (p.kind as EquipmentKind)
      : "MACHINE";

    // Недостающие поля добираем из EMPTY (черновик, сохранённый до появления нового поля),
    // лишние и кривые по типу — отбрасываем.
    const form = { ...EMPTY_MACHINE_FORM };
    for (const key of Object.keys(form) as (keyof MachineFormState)[]) {
      const v = (p.form as Record<string, unknown>)[key];
      if (key === "isUrgent") {
        if (typeof v === "boolean") form.isUrgent = v;
      } else if (typeof v === "string") {
        form[key] = v;
      }
    }

    return {
      category,
      kind,
      form,
      savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

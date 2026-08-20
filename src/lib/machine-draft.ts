// Тихий черновик формы заведения станка (решение Артёма 07.08.2026): закрыл модалку — ввод не
// пропал, при следующем открытии форма восстановлена. В отличие от черновиков заявок диспетчера
// (task-draft.ts, стек с чипами) здесь ОДИН черновик без UI-стека: Максим заводит один станок за
// раз, а плашка «Восстановлен черновик» с кнопкой «Начать заново» живёт прямо в форме.
//
// Фото в черновик не входят: File в localStorage не живёт; сохраняются только поля (PRD §16.5).
import { EquipmentFamily, EquipmentKind, MachineCategory } from "@/generated/prisma/enums";
import { configurationOptionsFor } from "./machine-configuration";

// Ключ версионирован (образец DRAFTS_STORAGE_KEY у задач): поменяется структура — старый
// черновик просто не прочитается, а не уронит форму.
// Черновик свой у каждого раздела (15.08.2026): начатый листогиб не должен всплывать в форме
// фальцепрокатника — там другие виды и другая нумерация.
// v3 (20.08.2026): категория стала списком, старый черновик с одиночной категорией не читаем.
const KEY_PREFIX = "vanmark:machine-draft:v3:";
const keyFor = (family: EquipmentFamily): string => KEY_PREFIX + family;

export const EMPTY_MACHINE_FORM = {
  model: "",
  ourNumber: "",
  configuration: "",
  metalThickness: "",
  price: "",
  contactName: "",
  invoice1C: "",
  responsibleId: "",
  deliveredBy: "",
  arrivedAt: "",
  dueDate: "",
  defectNotes: "",
  notes: "",
  isUrgent: false,
};

export type MachineFormState = typeof EMPTY_MACHINE_FORM;

export type MachineDraft = {
  categories: MachineCategory[];
  kind: EquipmentKind;
  /** Остаток складской позиции: он живёт вне form, но теряться при закрытии модалки не должен. */
  quantity: string;
  form: MachineFormState;
  savedAt: string; // ISO
};

/** Есть ли что терять: заполнено хоть одно поле (выбор категорий/вида сам по себе не в счёт). */
export function isDirtyMachineForm(form: MachineFormState): boolean {
  return Object.values(form).some((v) => (typeof v === "string" ? v.trim() !== "" : v === true));
}

// Поля, спрятанные за «Показать все поля»: если в черновике заполнено хоть одно — форму
// разворачиваем сразу, чтобы восстановленные значения не оказались невидимыми.
// Цена и толщина металла в списке НЕ значатся: с 20.08.2026 они видны сразу.
const HIDDEN_KEYS = [
  "contactName",
  "invoice1C",
  "responsibleId",
  "deliveredBy",
  "arrivedAt",
  "dueDate",
  "defectNotes",
  "notes",
] as const;

/**
 * Есть ли в черновике значения полей, которых на свёрнутой форме не видно.
 *
 * Комплектация — особый случай: у листогиба и фальцепрокатника она показывается сразу галочками,
 * а у ножа, фальц машинки и складских видов остаётся текстовым полем под кнопкой. Поэтому вид
 * обязателен: иначе восстановленный черновик ножа прятал бы уже введённую комплектацию, и человек
 * сохранял бы карточку со значением, которого не видел.
 */
export function hasHiddenFieldValues(form: MachineFormState, kind: EquipmentKind): boolean {
  if (HIDDEN_KEYS.some((k) => form[k].trim() !== "")) return true;
  return configurationOptionsFor(kind).length === 0 && form.configuration.trim() !== "";
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

    // Категории — список; всё, что не похоже на набор известных значений, лечится дефолтом.
    const categories = Array.isArray(p.categories)
      ? (p.categories.filter((c): c is MachineCategory =>
          Object.values(MachineCategory).includes(c as MachineCategory),
        ) as MachineCategory[])
      : [];
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
      categories: categories.length > 0 ? categories : ["CLIENT"],
      kind,
      quantity: typeof p.quantity === "string" ? p.quantity : "1",
      form,
      savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

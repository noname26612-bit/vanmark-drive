"use client";
/* eslint-disable @next/next/no-img-element -- локальные превью выбранных фото (blob:), next/image тут не нужен */

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import useSWR from "swr";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { newActionId as newIdempotencyKey } from "@/lib/offline/id";
import { KINDS_BY_FAMILY, MACHINE_CATEGORIES, headKindOf, isStockKind } from "@/domain/machine-status";
import { modelSuggestionPool } from "@/domain/machine-models";
import { EQUIPMENT_KIND_LABEL, MACHINE_CATEGORY_LABEL } from "@/lib/machine-ui";
import {
  EMPTY_MACHINE_FORM,
  clearMachineDraft,
  hasHiddenFieldValues,
  isDirtyMachineForm,
  loadMachineDraft,
  saveMachineDraft,
} from "@/lib/machine-draft";
import { cn } from "@/lib/cn";
import { ModelCombobox } from "./model-combobox";
import type { MachineDetail } from "@/lib/machine-dto";
import type { EquipmentFamily, EquipmentKind, MachineCategory } from "@/generated/prisma/enums";

// Кто обычно привозит станки — подсказки, а не жёсткий список (PRD §16.4).
const DELIVERED_BY = ["Каширский", "Писарев", "Султан", "Заказчик", "Яндекс"];

type Meta = { nextOurNumber: number; responsibles: { id: string; name: string }[]; models: string[] };

// Структура формы живёт в machine-draft.ts — её же сохраняет и восстанавливает черновик.
const EMPTY = EMPTY_MACHINE_FORM;

/**
 * Форма заведения станка. Цель — ≤30 секунд с телефона (PRD §16.5): наверху только вид, категория,
 * модель и фото, всё остальное — за «Показать все поля» (сворачивается обратно той же кнопкой).
 *
 * Ключевое: карточка сохраняется ДО фото. Ответ приходит сразу, форма закрывается, а снимки
 * догружаются фоном с автоповтором (uploadMachinePhotos) — обрыв связи на площадке не теряет ввод.
 *
 * Черновик (решение Артёма 07.08): закрытие крестиком/фоном/Escape молча сохраняет заполненную
 * форму в localStorage; следующее открытие восстанавливает её с плашкой «Восстановлен черновик».
 * Явная «Отмена» переспрашивает и выбрасывает. Фото в черновик не входят (File не сериализуется).
 */
export function MachineFormModal({
  open,
  family,
  onClose,
  locations,
  onCreated,
}: {
  open: boolean;
  family: EquipmentFamily;
  onClose: () => void;
  locations: string[];
  onCreated: (machine: MachineDetail, photos: File[]) => void;
}) {
  const kinds = KINDS_BY_FAMILY[family];
  const defaultKind = headKindOf(family);
  const [category, setCategory] = useState<MachineCategory>("CLIENT");
  const [kind, setKind] = useState<EquipmentKind>(defaultKind);
  // Складская позиция (размотчик, частотник) заводится количеством: ни категории, ни состояния у
  // остатка нет — вместо них одно поле «Сколько на складе».
  const stock = isStockKind(kind);
  const [quantity, setQuantity] = useState("1");
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState<File[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredDraft, setRestoredDraft] = useState(false);
  // Трогал ли человек номер руками: пока нет — показываем подсказку следующего свободного.
  const [ourNumberEdited, setOurNumberEdited] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Ключ идемпотентности живёт на ПОПЫТКУ СОХРАНЕНИЯ, а не на вызов submit(): при слабой связи ответ
  // может не дойти за таймаут, хотя станок уже создан. С новым ключом на каждое нажатие повтор завёл бы
  // второй станок с новым учётным номером — лечится только аннулированием карточки. Ключ обнуляется
  // при успехе и при повторном открытии формы.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  // Справочники формы (следующий «77-N», ответственные, модели для подсказок) — только когда открыта.
  const { data: meta } = useSWR<Meta>(open ? `/api/machines/meta?family=${family}` : null, fetcher);
  const modelPool = useMemo(() => modelSuggestionPool(meta?.models ?? []), [meta?.models]);

  // Сброс при каждом открытии — паттерн React «adjust state on prop change» (setState во время
  // рендера, не в эффекте: см. DateField). Вместо пустой формы поднимаем черновик, если он есть.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const draft = loadMachineDraft(family);
      if (draft && isDirtyMachineForm(draft.form)) {
        setCategory(draft.category);
        setKind(draft.kind);
        setForm(draft.form);
        // Восстановленные значения не должны прятаться за свёрнутыми полями.
        setShowAll(hasHiddenFieldValues(draft.form));
        setOurNumberEdited(draft.form.ourNumber.trim() !== "");
        setRestoredDraft(true);
      } else {
        setCategory("CLIENT");
        setKind(defaultKind);
        setForm(EMPTY);
        setShowAll(false);
        setOurNumberEdited(false);
        setRestoredDraft(false);
      }
      setQuantity("1");
      setPhotos([]);
      setError(null);
      setIdempotencyKey(null);
    }
  }

  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  const dirty = isDirtyMachineForm(form);

  // Закрытие крестиком/фоном/Escape: заполненную форму молча уносим в черновик — случайный тап
  // по фону не должен терять ввод (ровно жалоба Артёма).
  function handleClose() {
    if (saving) return;
    if (dirty) {
      saveMachineDraft(family, { category, kind, form });
    } else {
      clearMachineDraft(family);
    }
    onClose();
  }

  // Явная «Отмена» — осознанный выброс, с переспросом (образец черновиков заявок).
  function handleDiscard() {
    if (saving) return;
    if (dirty && !window.confirm("Выбросить черновик? Заполненные поля пропадут.")) return;
    clearMachineDraft(family);
    onClose();
  }

  // «Начать заново» на плашке восстановленного черновика.
  function startFresh() {
    clearMachineDraft(family);
    setCategory("CLIENT");
    setKind(defaultKind);
    setForm(EMPTY);
    setShowAll(false);
    setOurNumberEdited(false);
    setRestoredDraft(false);
    setError(null);
  }

  // Подсказываем следующий свободный номер раздела, но он остаётся правимым: при инвентаризации
  // номер уже написан маркером на железе и может быть любым (PRD §16.2). С 15.08.2026 номер
  // доступен любой категории — системный сквозной номер из интерфейса убран.
  const suggestedOurNumber = meta ? String(meta.nextOurNumber) : "";
  const ourNumberValue = ourNumberEdited ? form.ourNumber : suggestedOurNumber;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setPhotos((prev) => [...prev, ...Array.from(list)]);
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!form.model.trim()) {
      setError("Укажите модель");
      return;
    }
    setSaving(true);
    setError(null);
    // Один ключ на все попытки сохранить ЭТУ карточку — иначе повтор после таймаута создаст дубль.
    const key = idempotencyKey ?? newIdempotencyKey();
    if (!idempotencyKey) setIdempotencyKey(key);
    try {
      const ourNumber = ourNumberValue.trim();
      const created = await apiSend<MachineDetail>(
        "/api/machines",
        "POST",
        {
          family,
          category,
          kind,
          ...(stock ? { quantity: Number(quantity) || 0 } : {}),
          model: form.model.trim(),
          ourNumber: ourNumber ? Number(ourNumber) : null,
          configuration: form.configuration,
          metalThickness: form.metalThickness,
          serialNumber: form.serialNumber,
          orgName: form.orgName,
          contactName: form.contactName,
          contactPhone: form.contactPhone,
          invoice1C: form.invoice1C,
          responsibleId: form.responsibleId || null,
          deliveredBy: form.deliveredBy,
          arrivedAt: form.arrivedAt,
          dueDate: form.dueDate,
          defectNotes: form.defectNotes,
          location: form.location,
          notes: form.notes,
          isUrgent: form.isUrgent,
        },
        // Повтор после обрыва/таймаута не должен заводить второй станок — ключ тот же (см. выше).
        { "Idempotency-Key": key },
      );
      setIdempotencyKey(null); // карточка создана — следующая заводится своим ключом
      clearMachineDraft(family); // введённое доехало до БД — черновику больше нечего страховать
      // Фото передаём наверх: их догружает список, который не размонтируется вместе с формой.
      onCreated(created, photos);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить карточку");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Новая карточка: ${EQUIPMENT_KIND_LABEL[kind].toLowerCase()}`}
      wide
    >
      <div className="flex flex-col gap-3">
        {restoredDraft ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
            data-testid="machine-draft-restored"
          >
            <span className="text-sm text-neutral-600">
              Восстановлен черновик — форма заполнена тем, что вводили раньше.
            </span>
            <Button
              variant="ghost"
              className="!py-1 text-xs"
              onClick={startFresh}
              data-testid="machine-draft-fresh"
            >
              Начать заново
            </Button>
          </div>
        ) : null}

        {/* Вид оборудования — сегмент из двух кнопок (решение Артёма 07.08: ножи в общей картотеке). */}
        <div
          role="radiogroup"
          aria-label="Вид оборудования"
          className={cn("grid gap-2", kinds.length > 2 ? "grid-cols-3" : "grid-cols-2")}
        >
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              data-testid={`machine-kind-${k}`}
              className={cn(
                "min-h-12 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                kind === k
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 active:bg-neutral-50",
              )}
            >
              {EQUIPMENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {stock ? (
          <Field label="Сколько на складе" required hint="Остаток в штуках — состояний у него нет">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-32 shrink-0"
              data-testid="machine-quantity"
            />
          </Field>
        ) : (
          <Field label="Категория" required>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as MachineCategory)}
              data-testid="machine-category"
            >
              {MACHINE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MACHINE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Модель" required hint="Начните печатать — подскажем: «лбм», «ван», «tapco»…">
          <ModelCombobox
            value={form.model}
            onChange={(v) => set({ model: v })}
            models={modelPool}
            placeholder="Модель"
            autoFocus
            testId="machine-model"
          />
        </Field>

        {stock ? null : (
          <Field label="Учётный номер" hint="Подсказан следующий свободный — можно исправить">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-500">77-</span>
              <Input
                type="number"
                inputMode="numeric"
                value={ourNumberValue}
                onChange={(e) => {
                  setOurNumberEdited(true);
                  set({ ourNumber: e.target.value });
                }}
                className="w-28 shrink-0"
                data-testid="machine-our-number"
              />
            </div>
          </Field>
        )}

        <div>
          <span className="text-sm font-medium text-neutral-700">Фото</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {photos.map((f, i) => (
              <PhotoPreview key={`${f.name}-${f.lastModified}-${i}`} file={f} onRemove={() => removePhoto(i)} />
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 text-xs text-neutral-500 active:bg-neutral-50"
            >
              <Camera className="h-5 w-5" />
              Добавить
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
              data-testid="machine-photo-input"
            />
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Карточка сохранится сразу — фото догрузятся сами, даже если связь пропадёт.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={form.isUrgent}
            onChange={(e) => set({ isUrgent: e.target.checked })}
            className="h-4 w-4"
          />
          Срочный
        </label>

        {showAll ? (
          <div className="grid gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-2" data-testid="machine-extra-fields">
            <Field label="Комплектация" hint="нож, машинка, стойка…">
              <Input
                value={form.configuration}
                onChange={(e) => set({ configuration: e.target.value })}
              />
            </Field>
            <Field label="Толщина металла">
              <Input
                value={form.metalThickness}
                onChange={(e) => set({ metalThickness: e.target.value })}
                placeholder="0,7 мм"
              />
            </Field>
            <Field label="Серийный номер">
              <Input value={form.serialNumber} onChange={(e) => set({ serialNumber: e.target.value })} />
            </Field>
            <Field label="Место на площадке">
              <Input
                value={form.location}
                onChange={(e) => set({ location: e.target.value })}
                list="machine-locations"
                placeholder="Ряд Б, место 3"
              />
            </Field>
            <datalist id="machine-locations">
              {locations.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>

            <Field label="Заказчик">
              <Input value={form.orgName} onChange={(e) => set({ orgName: e.target.value })} />
            </Field>
            <Field label="Контакт">
              <Input value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} />
            </Field>
            <Field label="Телефон">
              <Input
                type="tel"
                value={form.contactPhone}
                onChange={(e) => set({ contactPhone: e.target.value })}
                placeholder="+7 900 000-00-00"
              />
            </Field>
            <Field label="№ заказа 1С">
              <Input value={form.invoice1C} onChange={(e) => set({ invoice1C: e.target.value })} />
            </Field>

            <Field label="Ответственный">
              <Select
                value={form.responsibleId}
                onChange={(e) => set({ responsibleId: e.target.value })}
              >
                <option value="">Не выбран</option>
                {(meta?.responsibles ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Кто привёз">
              <Input
                value={form.deliveredBy}
                onChange={(e) => set({ deliveredBy: e.target.value })}
                list="machine-delivered-by"
              />
            </Field>
            <datalist id="machine-delivered-by">
              {DELIVERED_BY.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>

            <Field label="Дата поступления">
              <DateField value={form.arrivedAt} onChange={(v) => set({ arrivedAt: v })} />
            </Field>
            <Field label="Срок готовности / выдачи" hint="Подсветим, когда останется ≤2 дней">
              <DateField
                value={form.dueDate}
                onChange={(v) => set({ dueDate: v })}
                testId="machine-form-due-date"
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Дефектовка" hint="что не работает — со слов клиента или по осмотру">
                <Textarea
                  rows={2}
                  value={form.defectNotes}
                  onChange={(e) => set({ defectNotes: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Заметки">
                <Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </div>
          </div>
        ) : null}
        {/* Переключатель виден всегда: раньше кнопка исчезала после разворота, и свернуть поля
            обратно было нельзя (правка Артёма 07.08). Данные в свёрнутых полях сохраняются. */}
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start text-sm font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
          data-testid="machine-toggle-fields"
        >
          {showAll ? "Скрыть дополнительные поля" : "Показать все поля"}
        </button>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={handleDiscard} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={saving} data-testid="machine-save">
            {saving ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Превью выбранного фото. blob-ссылка создаётся один раз на файл и освобождается при размонтировании:
 * вызов URL.createObjectURL прямо в разметке порождал бы новую ссылку на КАЖДЫЙ рендер (а рендер идёт
 * на каждую букву в форме) — и ни одна из них не освобождалась бы, пока открыта вкладка.
 */
function PhotoPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  // Ссылка создаётся один раз на файл (useMemo), освобождается при размонтировании/смене файла.
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <span className="relative">
      <img src={url} alt="" className="h-20 w-20 rounded-lg border border-neutral-200 object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Убрать фото"
        // Тач-цель 44px (ui-guidelines): крестик на 24px промахивался пальцем на телефоне.
        className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center text-neutral-900"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white">
          <X className="h-3.5 w-3.5" />
        </span>
      </button>
    </span>
  );
}

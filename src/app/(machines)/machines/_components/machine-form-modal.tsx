"use client";
/* eslint-disable @next/next/no-img-element -- локальные превью выбранных фото (blob:), next/image тут не нужен */

import { useRef, useState } from "react";
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
import { MACHINE_CATEGORIES, isOurCategory } from "@/domain/machine-status";
import { MACHINE_CATEGORY_LABEL } from "@/lib/machine-ui";
import type { MachineDetail } from "@/lib/machine-dto";
import type { MachineCategory } from "@/generated/prisma/enums";

// Кто обычно привозит станки — подсказки, а не жёсткий список (PRD §16.4).
const DELIVERED_BY = ["Каширский", "Писарев", "Султан", "Заказчик", "Яндекс"];

type Meta = { nextOurNumber: number; responsibles: { id: string; name: string }[] };

const EMPTY = {
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
  defectNotes: "",
  location: "",
  notes: "",
  isUrgent: false,
};

/**
 * Форма заведения станка. Цель — ≤30 секунд с телефона (PRD §16.5): наверху только категория,
 * модель и фото, всё остальное — за «Показать все поля».
 *
 * Ключевое: карточка сохраняется ДО фото. Ответ приходит сразу, форма закрывается, а снимки
 * догружаются фоном с автоповтором (uploadMachinePhotos) — обрыв связи на площадке не теряет ввод.
 */
export function MachineFormModal({
  open,
  onClose,
  locations,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  locations: string[];
  onCreated: (machine: MachineDetail, photos: File[]) => void;
}) {
  const [category, setCategory] = useState<MachineCategory>("CLIENT");
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState<File[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Трогал ли человек номер руками: пока нет — показываем подсказку следующего свободного.
  const [ourNumberEdited, setOurNumberEdited] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Справочные данные формы (следующий «77-N», список ответственных) — грузим только когда открыта.
  const { data: meta } = useSWR<Meta>(open ? "/api/machines/meta" : null, fetcher);

  // Сброс при каждом открытии — паттерн React «adjust state on prop change» (setState во время
  // рендера, не в эффекте: см. DateField). Форма короткая, черновики ей ни к чему в отличие от заявок.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setCategory("CLIENT");
      setForm(EMPTY);
      setPhotos([]);
      setShowAll(false);
      setError(null);
      setOurNumberEdited(false);
    }
  }

  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  // Наш станок — подсказываем следующий свободный номер, но он остаётся правимым: при
  // инвентаризации номер уже написан маркером на железе и может быть любым (PRD §16.2).
  const suggestedOurNumber = meta ? String(meta.nextOurNumber) : "";
  const ourNumberValue = ourNumberEdited ? form.ourNumber : suggestedOurNumber;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setPhotos((prev) => [...prev, ...Array.from(list)]);
  }

  async function submit() {
    if (!form.model.trim()) {
      setError("Укажите модель станка");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ourNumber = ourNumberValue.trim();
      const created = await apiSend<MachineDetail>(
        "/api/machines",
        "POST",
        {
          category,
          model: form.model.trim(),
          ourNumber: isOurCategory(category) && ourNumber ? Number(ourNumber) : null,
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
          defectNotes: form.defectNotes,
          location: form.location,
          notes: form.notes,
          isUrgent: form.isUrgent,
        },
        // Двойное нажатие на слабой связи не должно заводить два станка.
        { "Idempotency-Key": crypto.randomUUID() },
      );
      // Фото передаём наверх: их догружает список, который не размонтируется вместе с формой.
      onCreated(created, photos);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить станок");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новый станок" wide>
      <div className="flex flex-col gap-3">
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

        <Field label="Модель" required hint="«ЛБМ 200», «Sorex 2 м»">
          <Input
            value={form.model}
            onChange={(e) => set({ model: e.target.value })}
            placeholder="Модель станка"
            autoFocus
            data-testid="machine-model"
          />
        </Field>

        {isOurCategory(category) ? (
          <Field label="Наш номер" hint="Подсказан следующий свободный — можно исправить">
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
        ) : null}

        <div>
          <span className="text-sm font-medium text-neutral-700">Фото</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {photos.map((f, i) => (
              <span key={i} className="relative">
                <img
                  src={URL.createObjectURL(f)}
                  alt=""
                  className="h-20 w-20 rounded-lg border border-neutral-200 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                  aria-label="Убрать фото"
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
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
          <div className="grid gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-2">
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
        ) : (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="self-start text-sm font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
          >
            Показать все поля
          </button>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
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

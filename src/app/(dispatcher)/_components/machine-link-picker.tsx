"use client";

// Выбор станков для заявки (этап 2 модуля оборудования, 21.08.2026, PRD §16.1).
//
// Модалка поверх формы заявки: Милена не уходит с заполненной формы, чтобы найти станок, и может
// завести новую карточку прямо отсюда — «привезли на выкуп, карточки ещё нет» случается постоянно.
// Стек модалок (components/ui/modal) держит цепочку: заявка → пикер → форма станка.
//
// Строки с галочками, а не выпадашка (ui-guidelines, решение Артёма 20.08.2026). Список раздела
// грузится целиком (десятки карточек) и фильтруется на клиенте — тем же движком, что ищет по
// картотеке, поэтому «77-5», «к5» и «лбм» находят одно и то же и здесь, и там.
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Plus, Search, X } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { machineMatches, parseQuery } from "@/lib/machine-search";
import { EQUIPMENT_FAMILIES, isStockKind } from "@/domain/machine-status";
import {
  EQUIPMENT_FAMILY_LABEL,
  EQUIPMENT_KIND_SHORT,
  MACHINE_STATUS_LABEL,
  formatMachineNumber,
  pickerLabel,
} from "@/lib/machine-ui";

// Подпись станка переехала в @/lib/machine-ui (её собирает и чистый lib/task-draft при копировании
// заявки). Реэкспорт — чтобы соседние модули не переучивать на новый путь.
export { pickerLabel };
import { isHeadKind } from "@/domain/machine-status";
import { MachineFormModal } from "../../(machines)/machines/_components/machine-form-modal";
import { uploadMachinePhotos } from "@/lib/machine-photo-upload";
import type { MachineDetail, MachinePickerItem } from "@/lib/machine-dto";
import type { EquipmentFamily } from "@/generated/prisma/enums";

export type PickedMachine = {
  machineId: string;
  label: string; // «77-5 · ЛБМ 200» — то, что видно чипом в форме заявки
  status: MachinePickerItem["status"];
};

export function MachineLinkPicker({
  open,
  selectedIds,
  onClose,
  onToggle,
}: {
  open: boolean;
  selectedIds: string[];
  onClose: () => void;
  /** Клик по строке: снять или добавить. Направление и порядок держит форма заявки. */
  onToggle: (machine: PickedMachine) => void;
}) {
  const [family, setFamily] = useState<EquipmentFamily>("BENDER");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR<{ machines: MachinePickerItem[] }>(
    open ? `/api/machines/picker?family=${family}` : null,
    fetcher,
  );

  const query = useMemo(() => (q.trim() ? parseQuery(q) : null), [q]);
  const machines = useMemo(() => {
    const all = data?.machines ?? [];
    return query?.active ? all.filter((m) => machineMatches(m, query)) : all;
  }, [data?.machines, query]);

  /**
   * Карточка заведена прямо из формы заявки — сразу отмечаем её выбранной: человек за этим сюда и
   * шёл. Фото уезжают фоном (как в картотеке), их результат показываем строкой-плашкой.
   */
  async function handleCreated(machine: MachineDetail, photos: File[]) {
    setCreateOpen(false);
    await mutate();
    if (!isStockKind(machine.kind)) {
      onToggle({
        machineId: machine.id,
        label: pickerLabel(machine),
        status: machine.status,
      });
    }
    if (photos.length === 0) return;
    setPhotoNote(`Загружаю фото ${machine.model}…`);
    const failed = await uploadMachinePhotos(machine.id, photos, () => {});
    setPhotoNote(
      failed.length === 0
        ? null
        : `${failed.length} фото не загрузилось — откройте карточку станка и добавьте ещё раз.`,
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Выбрать станок" wide>
      <div className="flex flex-col gap-3">
        {/* Раздел — сегментом: разделы не смешиваются нигде, включая пикер. */}
        <div className="flex gap-1.5" role="tablist" aria-label="Раздел оборудования">
          {EQUIPMENT_FAMILIES.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={family === f}
              onClick={() => setFamily(f)}
              data-testid={`picker-family-${f}`}
              className={cn(
                "min-h-10 rounded-lg border px-3 text-sm font-medium transition-colors",
                family === f
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400",
              )}
            >
              {EQUIPMENT_FAMILY_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск: № / модель / заказ 1С"
            className="pl-9 pr-9"
            data-testid="picker-search"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:bg-neutral-100"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {photoNote ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {photoNote}
          </p>
        ) : null}

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-neutral-200">
          {isLoading && machines.length === 0 ? (
            <p className="p-3 text-sm text-neutral-500">Загружаю картотеку…</p>
          ) : machines.length === 0 ? (
            <p className="p-3 text-sm text-neutral-500">
              {q.trim() ? "Ничего не нашлось — проверьте номер или модель." : "В разделе пока пусто."}
            </p>
          ) : (
            <ul data-testid="picker-list">
              {machines.map((m) => {
                const checked = selectedIds.includes(m.id);
                return (
                  <li key={m.id} className="border-b border-neutral-100 last:border-0">
                    <button
                      type="button"
                      onClick={() =>
                        onToggle({ machineId: m.id, label: pickerLabel(m), status: m.status })
                      }
                      data-testid={`picker-row-${m.id}`}
                      aria-pressed={checked}
                      className={cn(
                        "flex min-h-12 w-full items-start gap-3 px-3 py-2 text-left transition-colors",
                        checked ? "bg-neutral-100" : "hover:bg-neutral-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        tabIndex={-1}
                        className="pointer-events-none mt-1 h-4 w-4 shrink-0"
                      />
                      {/* Всё в один переносимый ряд: на телефоне (360 px) бейджи уезжают на вторую
                          строку целиком, а номер и модель не сжимаются в «Мобильн…». */}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="whitespace-nowrap font-medium text-neutral-900">
                            {formatMachineNumber(m) ?? "без номера"}
                          </span>
                          <span className="break-words text-neutral-700">{m.model}</span>
                          {!isHeadKind(m.kind) ? (
                            <span className="whitespace-nowrap rounded border border-slate-300 px-1.5 text-xs text-slate-600">
                              {EQUIPMENT_KIND_SHORT[m.kind]}
                            </span>
                          ) : null}
                          <span className="whitespace-nowrap rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600">
                            {MACHINE_STATUS_LABEL[m.status]}
                          </span>
                          {/* Янтарная точка — обязательные отметки не проставлены. Подсказка, не
                              запрет: привязать станок можно, просто его давно не смотрели. */}
                          {m.marksUnset ? (
                            <span
                              title="Диагностика или сверка не отмечены"
                              aria-label="Отметки не проставлены"
                              className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                            />
                          ) : null}
                        </span>
                        {m.configuration ? (
                          <span className="mt-0.5 block truncate text-xs text-neutral-500">
                            {m.configuration}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCreateOpen(true)}
            data-testid="picker-create-machine"
          >
            <Plus className="h-4 w-4" /> Завести новый станок
          </Button>
          <Button type="button" onClick={onClose} data-testid="picker-done">
            Готово
          </Button>
        </div>
      </div>

      {/* Третий этаж цепочки модалок. Форма станка та же, что в картотеке, — своей копии нет. */}
      <MachineFormModal
        open={createOpen}
        family={family}
        onClose={() => setCreateOpen(false)}
        onCreated={(machine, photos) => void handleCreated(machine, photos)}
      />
    </Modal>
  );
}

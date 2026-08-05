"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/machines/photos/:id по сессионной
   куке; next/image ходит через свой прокси без куки и получил бы 404 (как у вложений задач). */

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, ImageOff, Plus, Search, X } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Highlighted } from "@/components/highlight";
import { firstHiddenMachineMatch, machineMatches, parseQuery } from "@/lib/machine-search";
import { MACHINE_CATEGORIES, MACHINE_STATUSES, statusesForCategory } from "@/domain/machine-status";
import {
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_BAR,
  MACHINE_STATUS_LABEL,
  machineTitle,
} from "@/lib/machine-ui";
import type { MachineDetail, MachineListItem, MachineListResult } from "@/lib/machine-dto";
import type { MachineCategory, MachineStatus } from "@/generated/prisma/enums";
import { MachineCategoryBadge, MachineStatusBadge } from "./_components/machine-badges";
import { MachineFormModal } from "./_components/machine-form-modal";
import { uploadMachinePhotos } from "@/lib/machine-photo-upload";

type FlagKey = "noInvoice1C" | "urgent" | "awaitingDiagnosis" | "staleVerification";

// Плитки-индикаторы. Цвет — только там, где он несёт смысл (ui-guidelines): янтарь = требует
// действия сейчас. «Срочные» — тоже янтарь: это очередь, а не авария.
const FLAG_TILES: { key: FlagKey; label: string; hint: string }[] = [
  { key: "urgent", label: "Срочные", hint: "помечены как срочные" },
  { key: "awaitingDiagnosis", label: "Ждут диагностики", hint: "приняты больше рабочего дня назад" },
  { key: "noInvoice1C", label: "Без заказа 1С", hint: "клиентские без номера заказа" },
  { key: "staleVerification", label: "Давно не сверялись", hint: "не подтверждали больше недели" },
];

// Фоновая догрузка фото после создания карточки: статус показываем плашкой, чтобы человек видел,
// что снимки уезжают, и не думал, что они потерялись.
type PhotoJob = { machineNumber: number; done: number; total: number; failed: number };

export function MachinesClient() {
  const [scope, setScope] = useState<"active" | "archive">("active");
  const [category, setCategory] = useState<"" | MachineCategory>("");
  const [status, setStatus] = useState<"" | MachineStatus>("");
  const [flag, setFlag] = useState<FlagKey | "">("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [photoJob, setPhotoJob] = useState<PhotoJob | null>(null);
  const [archivePages, setArchivePages] = useState(1);

  // Архив ищем на сервере (записей много, копятся годами) — запрос уходит через 250 мс после
  // остановки ввода. Активные (десятки) фильтруются здесь же, мгновенно.
  const debouncedQ = useDebouncedValue(q, 250);
  const params = new URLSearchParams();
  params.set("scope", scope);
  if (category) params.set("category", category);
  if (status) params.set("status", status);
  if (flag) params.set("flag", flag);
  if (scope === "archive") {
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    params.set("take", String(archivePages * 30));
  }

  const { data, isLoading, error, mutate } = useSWR<MachineListResult>(
    `/api/machines?${params.toString()}`,
    fetcher,
    { keepPreviousData: true, refreshInterval: 30_000 },
  );

  const summary = data?.summary;
  const query = useMemo(() => (q.trim() ? parseQuery(q) : null), [q]);

  // Активные фильтруем клиентски — поиск отзывается на каждую букву без похода в сеть.
  const machines = useMemo(() => {
    const all = data?.machines ?? [];
    if (scope === "archive" || !query?.active) return all;
    return all.filter((m) => machineMatches(m, query));
  }, [data?.machines, query, scope]);

  async function handleCreated(machine: MachineDetail, photos: File[]) {
    await mutate();
    if (photos.length === 0) return;
    setPhotoJob({ machineNumber: machine.number, done: 0, total: photos.length, failed: 0 });
    const failed = await uploadMachinePhotos(machine.id, photos, (p) =>
      setPhotoJob({ machineNumber: machine.number, ...p }),
    );
    await mutate();
    // Успех убираем сам через пару секунд, ошибку оставляем на экране — её должен увидеть человек.
    if (failed.length === 0) setTimeout(() => setPhotoJob(null), 2500);
  }

  const resetFilters = () => {
    setCategory("");
    setStatus("");
    setFlag("");
    setQ("");
  };
  const filtersOn = Boolean(category || status || flag || q.trim());

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-neutral-900">Станки</h1>
        <Button onClick={() => setCreateOpen(true)} data-testid="machine-create">
          <Plus className="h-4 w-4" /> Станок
        </Button>
      </div>

      {photoJob ? (
        <div
          className={cn(
            "mb-3 rounded-lg border px-3 py-2 text-sm",
            photoJob.failed > 0
              ? "border-amber-500 bg-amber-50 text-amber-800"
              : "border-neutral-200 bg-white text-neutral-600",
          )}
        >
          {photoJob.failed > 0
            ? `Станок №${photoJob.machineNumber} сохранён, но ${photoJob.failed} фото не загрузилось — откройте карточку и добавьте ещё раз.`
            : `Станок №${photoJob.machineNumber} сохранён. Загружаю фото ${photoJob.done}/${photoJob.total}…`}
        </div>
      ) : null}

      {/* ── Сводка: категории, состояния и индикаторы. Клик = фильтр списка ── */}
      {summary ? (
        <div className="mb-4 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryTile
              label="Всего на площадке"
              value={summary.total}
              active={!category && !status && !flag && scope === "active"}
              onClick={() => {
                setScope("active");
                resetFilters();
              }}
            />
            {MACHINE_CATEGORIES.map((c) => (
              <SummaryTile
                key={c}
                label={MACHINE_CATEGORY_LABEL[c]}
                value={summary.byCategory[c]}
                active={category === c && scope === "active"}
                onClick={() => {
                  setScope("active");
                  setFlag("");
                  setCategory(category === c ? "" : c);
                }}
              />
            ))}
          </div>

          {/* Состояния и индикаторы — компактными чипами, а не плитками: на телефоне 13 плиток
              съедали весь первый экран, и до списка станков приходилось долго скроллить. */}
          <div className="flex flex-wrap gap-1.5">
            {MACHINE_STATUSES.filter((s) => !["RELEASED", "SOLD", "VOIDED"].includes(s)).map((s) => (
              <SummaryChip
                key={s}
                label={MACHINE_STATUS_LABEL[s]}
                value={summary.byStatus[s]}
                active={status === s && scope === "active"}
                onClick={() => {
                  setScope("active");
                  setFlag("");
                  setStatus(status === s ? "" : s);
                }}
              />
            ))}
            <SummaryChip
              label="Архив"
              value={summary.archived + summary.voided}
              active={scope === "archive"}
              onClick={() => {
                setScope("archive");
                resetFilters();
              }}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {FLAG_TILES.map((t) => (
              <SummaryChip
                key={t.key}
                label={t.label}
                hint={t.hint}
                value={summary[t.key]}
                accent={summary[t.key] > 0}
                active={flag === t.key && scope === "active"}
                onClick={() => {
                  setScope("active");
                  setCategory("");
                  setStatus("");
                  setFlag(flag === t.key ? "" : t.key);
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Поиск и фильтры ── */}
      {/* Поиск на всю ширину, фильтры — по два в ряд: на телефоне три отдельных ряда селектов
          отодвигали список станков ещё на экран вниз. */}
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="relative col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск: № / модель / заказчик / телефон"
            className="pl-9 pr-9"
            data-testid="machine-search"
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

        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value as MachineCategory | "")}
          data-testid="machine-filter-category"
        >
          <option value="">Любая категория</option>
          {MACHINE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {MACHINE_CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>

        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as MachineStatus | "")}
          data-testid="machine-filter-status"
        >
          <option value="">Любое состояние</option>
          {(category ? statusesForCategory(category) : MACHINE_STATUSES).map((s) => (
            <option key={s} value={s}>
              {MACHINE_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>

        <div className="flex items-center gap-2">
          <Select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as "active" | "archive");
              setArchivePages(1);
            }}
            data-testid="machine-filter-scope"
          >
            <option value="active">На площадке</option>
            <option value="archive">Архив</option>
          </Select>
          {filtersOn ? (
            <Button variant="ghost" onClick={resetFilters} className="shrink-0">
              Сбросить
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── Список ── */}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Не удалось загрузить картотеку. Проверьте связь и обновите страницу.
        </p>
      ) : isLoading && !data ? (
        <p className="text-sm text-neutral-500">Загружаю…</p>
      ) : machines.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white px-3 py-6 text-center text-sm text-neutral-500">
          {filtersOn ? "Ничего не нашлось — попробуйте изменить фильтры." : "Пока ни одного станка."}
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-neutral-500">
            {query?.active ? `Найдено: ${machines.length}` : `Показано: ${machines.length}`}
          </p>
          <ul className="flex flex-col gap-2" data-testid="machine-list">
            {machines.map((m) => (
              <MachineRow key={m.id} machine={m} query={query} />
            ))}
          </ul>
          {scope === "archive" && data?.hasMore ? (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" onClick={() => setArchivePages((p) => p + 1)}>
                Показать ещё
              </Button>
            </div>
          ) : null}
        </>
      )}

      <MachineFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        locations={data?.locations ?? []}
        onCreated={handleCreated}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  active,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        "flex flex-col items-start rounded-lg border bg-white px-3 py-2 text-left transition-colors",
        active ? "border-neutral-900" : "border-neutral-200 hover:border-neutral-400",
      )}
    >
      <span className={cn("text-xl font-semibold", accent ? "text-amber-600" : "text-neutral-900")}>
        {value}
      </span>
      <span className="text-xs text-neutral-500">{label}</span>
    </button>
  );
}

// Компактный счётчик-фильтр: число + подпись в одну строку. Цветом выделяем только то, что
// требует действия (ui-guidelines: янтарь = «сейчас»), и только когда счётчик не нулевой.
function SummaryChip({
  label,
  value,
  hint,
  active,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "border-neutral-900 bg-white text-neutral-900"
          : accent
            ? "border-amber-500 bg-white text-amber-700"
            : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400",
      )}
    >
      <span className="text-sm font-semibold">{value}</span>
      {label}
    </button>
  );
}

function MachineRow({
  machine: m,
  query,
}: {
  machine: MachineListItem;
  query: ReturnType<typeof parseQuery> | null;
}) {
  const title = machineTitle(m);
  const hidden = query?.active
    ? firstHiddenMachineMatch(m, query, [m.model, m.location ?? "", title])
    : null;

  return (
    <li>
      <Link
        href={`/machines/${m.id}`}
        className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-neutral-200 bg-white active:bg-neutral-50 sm:hover:border-neutral-300"
      >
        <span className={cn("w-1 shrink-0", MACHINE_STATUS_BAR[m.status])} aria-hidden />

        {m.photoId ? (
          <img
            src={`/api/machines/photos/${m.photoId}`}
            alt=""
            loading="lazy"
            className="my-2 h-16 w-16 shrink-0 rounded-lg border border-neutral-200 object-cover"
          />
        ) : (
          <span className="my-2 flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-neutral-200 text-neutral-300">
            <ImageOff className="h-5 w-5" />
          </span>
        )}

        <span className="flex min-w-0 flex-1 flex-col gap-1 py-2 pr-3">
          <span className="flex flex-wrap items-center gap-2">
            {m.isUrgent ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label="Срочный" />
            ) : null}
            <span className="text-sm font-medium text-neutral-900">
              <Highlighted text={title} query={query} />
            </span>
            <MachineStatusBadge status={m.status} />
            <MachineCategoryBadge category={m.category} />
          </span>

          <span className="truncate text-sm text-neutral-800">
            <Highlighted text={m.model} query={query} />
            {m.metalThickness ? (
              <span className="text-neutral-500"> · {m.metalThickness}</span>
            ) : null}
          </span>

          <span className="flex flex-wrap gap-x-3 text-xs text-neutral-500">
            {m.location ? (
              <span>
                Место: <Highlighted text={m.location} query={query} />
              </span>
            ) : null}
            {m.orgName ? (
              <span className="truncate">
                <Highlighted text={m.orgName} query={query} />
              </span>
            ) : null}
            {m.category === "CLIENT" && !m.invoice1C ? (
              <span className="text-amber-700">Без заказа 1С</span>
            ) : null}
            {m.photoCount > 1 ? <span>{m.photoCount} фото</span> : null}
          </span>

          {hidden ? (
            <span className="text-xs text-neutral-500">
              {hidden.label}: <Highlighted text={hidden.text} query={query} phone={hidden.phone} />
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

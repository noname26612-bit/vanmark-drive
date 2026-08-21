"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { Plus, Search, X } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { machineMatches, parseQuery } from "@/lib/machine-search";
import {
  KINDS_BY_FAMILY,
  MACHINE_CATEGORIES,
  SELECTABLE_MACHINE_STATUSES,
  headKindOf,
  isArchivedStatus,
  isStockKind,
} from "@/domain/machine-status";
import {
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_PLURAL,
  MACHINE_CATEGORY_LABEL,
  MACHINE_STATUS_LABEL,
  formatMachineNumber,
} from "@/lib/machine-ui";
import {
  applyView,
  parseView,
  saveView,
  serverViewSnapshot,
  subscribeView,
  viewSnapshot,
  type EquipmentView,
} from "@/lib/equipment-view";
import type { MachineDetail, MachineListResult } from "@/lib/machine-dto";
import type { EquipmentFamily, EquipmentKind, MachineCategory, MachineStatus } from "@/generated/prisma/enums";
import { MachineFormModal } from "../machines/_components/machine-form-modal";
import { uploadMachinePhotos } from "@/lib/machine-photo-upload";
import { EquipmentList } from "./equipment-list";
import { EquipmentFilters } from "./equipment-filters";

type FlagKey = "urgent" | "awaitingDiagnosis" | "notVerified" | "duePressing";

// Индикаторы-подсказки. Все живут под «Ещё»: наверху строки счётчиков с 20.08.2026 стоят то, по
// чему Артём смотрит парк каждый день, — категории и аренда, а не поводы для беспокойства.
const FLAG_TILES: { key: FlagKey; label: string; hint: string }[] = [
  { key: "duePressing", label: "Горит срок", hint: "срок прошёл или в ближайшие 2 дня" },
  { key: "urgent", label: "Срочные", hint: "помечены как срочные" },
  { key: "awaitingDiagnosis", label: "Ждут диагностики", hint: "диагностику ещё не отмечали" },
  { key: "notVerified", label: "Не подтверждены", hint: "не отмечали, что станок на месте" },
];

// Постоянная строка счётчиков (решение Артёма 20.08.2026: «нужно выводить Всего, Наш на продажу,
// Наш арендный, Клиентский, В аренде; остальное — по кнопке "Ещё"»). Порядок его: сначала своё,
// потом чужое — так парк и обсуждают. Поэтому это не MACHINE_CATEGORIES, а отдельный список.
const PRIMARY_CATEGORIES: readonly MachineCategory[] = ["OUR_SALE", "OUR_RENTAL", "CLIENT"];
const PRIMARY_STATUSES: readonly MachineStatus[] = ["RENTED"];

// Остальные категории («Выставочный вариант», «Под настройку ножей» — 21.08.2026) живут под «Ещё»:
// постоянный ряд Артём собрал под ежедневный обзор парка, и разбавлять его редкими не надо.
// Список считается из MACHINE_CATEGORIES — новая категория появится здесь сама.
const SECONDARY_CATEGORIES: readonly MachineCategory[] = MACHINE_CATEGORIES.filter(
  (c) => !PRIMARY_CATEGORIES.includes(c),
);

// Фоновая догрузка фото после создания карточки: статус показываем плашкой, чтобы человек видел,
// что снимки уезжают, и не думал, что они потерялись.
type PhotoJob = { title: string; done: number; total: number; failed: number };

export function EquipmentClient({
  family,
  title,
  basePath,
}: {
  family: EquipmentFamily;
  title: string;
  basePath: string;
}) {
  const [scope, setScope] = useState<"active" | "archive">("active");
  const [category, setCategory] = useState<"" | MachineCategory>("");
  const [status, setStatus] = useState<"" | MachineStatus>("");
  const [kind, setKind] = useState<"" | EquipmentKind>("");
  const [flag, setFlag] = useState<FlagKey | "">("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [photoJob, setPhotoJob] = useState<PhotoJob | null>(null);
  const [archivePages, setArchivePages] = useState(1);
  const [moreCounters, setMoreCounters] = useState(false);

  // Вид списка личный и лежит в localStorage. Читаем его через useSyncExternalStore: на сервере
  // снимок «по умолчанию», на клиенте — сохранённый, и разметка при гидрации не расходится.
  const rawView = useSyncExternalStore(
    subscribeView,
    useCallback(() => viewSnapshot(family), [family]),
    serverViewSnapshot,
  );
  const view = useMemo(() => parseView(rawView), [rawView]);
  const changeView = (next: EquipmentView) => saveView(family, next);

  // Архив ищем на сервере (записей много, копятся годами) — запрос уходит через 250 мс после
  // остановки ввода. Активные (десятки) фильтруются здесь же, мгновенно.
  const debouncedQ = useDebouncedValue(q, 250);
  const params = new URLSearchParams();
  params.set("family", family);
  params.set("scope", scope);
  if (category) params.set("category", category);
  if (status) params.set("status", status);
  if (kind) params.set("kind", kind);
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

  const groups = useMemo(() => applyView(machines, view), [machines, view]);
  const kinds = KINDS_BY_FAMILY[family];
  const headKind = headKindOf(family);

  async function handleCreated(machine: MachineDetail, photos: File[]) {
    await mutate();
    if (photos.length === 0) return;
    const label = formatMachineNumber(machine) ?? machine.model;
    setPhotoJob({ title: label, done: 0, total: photos.length, failed: 0 });
    const failed = await uploadMachinePhotos(machine.id, photos, (p) =>
      setPhotoJob({ title: label, ...p }),
    );
    await mutate();
    // Успех убираем сам через пару секунд, ошибку оставляем на экране — её должен увидеть человек.
    if (failed.length === 0) setTimeout(() => setPhotoJob(null), 2500);
  }

  const resetFilters = () => {
    setCategory("");
    setStatus("");
    setKind("");
    setFlag("");
    setQ("");
  };
  const filtersOn = Boolean(category || status || kind || flag || q.trim());

  // Переключение области просмотра: фильтры, несовместимые с новой областью, снимаем сразу.
  // Иначе комбинации молча дают пустой список — «Архив» + состояние с площадки или «Архив» +
  // плитка-индикатор (индикаторы считаются только по оборудованию на площадке).
  function switchScope(next: "active" | "archive") {
    setScope(next);
    setArchivePages(1);
    setFlag("");
    if (status && (next === "archive") !== isArchivedStatus(status)) setStatus("");
  }

  // Складские остатки состояний и категорий не имеют — при выборе их плашки эти фильтры убираем,
  // иначе экран предлагал бы отфильтровать размотчики по «Требует ремонта» и показывал пустоту.
  const stockOnly = kind !== "" && isStockKind(kind);

  return (
    /* Ширину держим в разумных рамках: на широком мониторе таблица, растянутая на 2000+ px,
       превращается в поля пустоты между колонками. */
    <div className="mx-auto max-w-[1400px] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        <Button onClick={() => setCreateOpen(true)} data-testid="machine-create">
          <Plus className="h-4 w-4" /> {EQUIPMENT_KIND_LABEL[headKind]}
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
            ? `${photoJob.title} сохранён, но ${photoJob.failed} фото не загрузилось — откройте карточку и добавьте ещё раз.`
            : `${photoJob.title} сохранён. Загружаю фото ${photoJob.done}/${photoJob.total}…`}
        </div>
      ) : null}

      {/* ── Плашки видов: главное деление раздела (решение Артёма 15.08.2026) ── */}
      {summary ? (
        <div
          className="mb-3 flex flex-wrap gap-1.5 sm:justify-center sm:gap-2"
          data-testid="kind-tabs"
        >
          <KindTab
            label="Все"
            active={kind === "" && scope === "active"}
            onClick={() => {
              switchScope("active");
              setKind("");
            }}
          />
          {kinds.map((k) => (
            <KindTab
              key={k}
              label={EQUIPMENT_KIND_PLURAL[k]}
              value={summary.byKind[k]}
              active={kind === k && scope === "active"}
              onClick={() => {
                switchScope("active");
                setKind(kind === k ? "" : k);
                if (isStockKind(k)) {
                  setStatus("");
                  setCategory("");
                  setFlag("");
                }
              }}
            />
          ))}
        </div>
      ) : null}

      {/* ── Счётчики: чем меряют парк каждый день; остальное под «Ещё» ── */}
      {summary && !stockOnly ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 sm:justify-center sm:gap-2">
          <SummaryChip
            label="Всего"
            value={summary.total}
            active={!category && !status && !flag && scope === "active"}
            onClick={() => {
              switchScope("active");
              resetFilters();
            }}
          />
          {/* Категории и «В аренде» — постоянный ряд (решение Артёма 20.08.2026): именно так он
              смотрит парк — сколько своего на продажу, сколько арендного, сколько чужого и сколько
              сейчас у клиентов. Станок с двумя категориями считается в обеих, поэтому сумма по
              категориям бывает больше «Всего» — это не ошибка, а тот же станок в двух ролях. */}
          {PRIMARY_CATEGORIES.map((c) => (
            <SummaryChip
              key={c}
              label={MACHINE_CATEGORY_LABEL[c]}
              value={summary.byCategory[c]}
              active={category === c && scope === "active"}
              onClick={() => {
                switchScope("active");
                setStatus("");
                setFlag("");
                setCategory(category === c ? "" : c);
              }}
            />
          ))}
          {PRIMARY_STATUSES.map((s) => (
            <SummaryChip
              key={s}
              label={MACHINE_STATUS_LABEL[s]}
              value={summary.byStatus[s]}
              active={status === s && scope === "active"}
              onClick={() => {
                switchScope("active");
                setCategory("");
                setFlag("");
                setStatus(status === s ? "" : s);
              }}
            />
          ))}
          {/* Под «Ещё» — редкие категории, остальные состояния и индикаторы. Выбранный чип
              показываем всегда, иначе свёрнутая строка молча теряла бы активный фильтр, а список
              оставался отфильтрованным. */}
          {SECONDARY_CATEGORIES.filter((c) => moreCounters || category === c).map((c) => (
            <SummaryChip
              key={c}
              label={MACHINE_CATEGORY_LABEL[c]}
              value={summary.byCategory[c]}
              active={category === c && scope === "active"}
              onClick={() => {
                switchScope("active");
                setStatus("");
                setFlag("");
                setCategory(category === c ? "" : c);
              }}
            />
          ))}
          {SELECTABLE_MACHINE_STATUSES.filter(
            (s) => !isArchivedStatus(s) && !PRIMARY_STATUSES.includes(s),
          )
            .filter((s) => moreCounters || status === s)
            .map((s) => (
              <SummaryChip
                key={s}
                label={MACHINE_STATUS_LABEL[s]}
                value={summary.byStatus[s]}
                active={status === s && scope === "active"}
                onClick={() => {
                  switchScope("active");
                  setCategory("");
                  setFlag("");
                  setStatus(status === s ? "" : s);
                }}
              />
            ))}
          {FLAG_TILES.filter((t) => moreCounters || flag === t.key).map((t) => (
            <SummaryChip
              key={t.key}
              label={t.label}
              hint={t.hint}
              value={summary[t.key]}
              accent={summary[t.key] > 0}
              active={flag === t.key && scope === "active"}
              onClick={() => {
                const next = flag === t.key ? "" : t.key;
                switchScope("active");
                setCategory("");
                setStatus("");
                setFlag(next);
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => setMoreCounters((v) => !v)}
            className="min-h-10 rounded-lg px-2 text-xs text-neutral-500 underline hover:text-neutral-800"
            data-testid="counters-more"
          >
            {moreCounters ? "Свернуть" : "Ещё"}
          </button>
        </div>
      ) : null}

      {/* ── Поиск ── */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: № / модель / заказ 1С"
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

      {/* Фильтры и вид — сбоку строками с галочками (решение Артёма 20.08.2026: выпадающие списки
          он читать не хочет, а на широком экране слева всё равно пустует место). Фильтр «Любое
          состояние» убран совсем: состояние выбирают чипами выше, и два разных способа фильтровать
          одно и то же расходились между собой. */}
      <div className="lg:flex lg:items-start lg:gap-4">
        <aside className="mb-3 lg:mb-0 lg:w-52 lg:shrink-0">
          <EquipmentFilters
            view={view}
            onView={changeView}
            scope={scope}
            onScope={switchScope}
            filtersOn={filtersOn}
            onReset={resetFilters}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Не удалось загрузить картотеку. Проверьте связь и обновите страницу.
            </p>
          ) : isLoading && !data ? (
            <p className="text-sm text-neutral-500">Загружаю…</p>
          ) : machines.length === 0 ? (
            <p className="rounded-lg border border-neutral-200 bg-white px-3 py-6 text-center text-sm text-neutral-500">
              {filtersOn ? "Ничего не нашлось — попробуйте изменить фильтры." : "Пока пусто."}
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-neutral-500">
                {query?.active ? `Найдено: ${machines.length}` : `Показано: ${machines.length}`}
              </p>
              <EquipmentList
                groups={groups}
                query={query}
                basePath={basePath}
                family={family}
              />
              {scope === "archive" && data?.hasMore ? (
                <div className="mt-3 flex justify-center">
                  <Button variant="secondary" onClick={() => setArchivePages((p) => p + 1)}>
                    Показать ещё
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <MachineFormModal
        open={createOpen}
        family={family}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}

/** Плашка вида: главное деление раздела. Крупнее чипов-счётчиков — это навигация, а не фильтр-мелочь. */
function KindTab({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // За компьютером плашки крупные (Артём 15.08.2026), на телефоне — прежний компактный
        // размер: иначе шесть плашек съедают экран до того, как начнётся сам список.
        "inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors sm:min-h-12 sm:px-6 sm:text-base",
        active
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400",
      )}
    >
      {label}
      {value !== undefined ? (
        <span className={cn("text-xs sm:text-sm", active ? "text-neutral-300" : "text-neutral-400")}>
          {value}
        </span>
      ) : null}
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
        "inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors sm:min-h-11 sm:px-4 sm:text-sm",
        active
          ? "border-neutral-900 bg-white text-neutral-900"
          : accent
            ? "border-amber-500 bg-white text-amber-700"
            : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400",
      )}
    >
      <span className="text-sm font-semibold sm:text-base">{value}</span>
      {label}
    </button>
  );
}

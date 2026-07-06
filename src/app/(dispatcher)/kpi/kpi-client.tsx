"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, apiSend } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { formatMoney, formatDate, formatPeriod, shiftPeriod, STATUS_LABEL } from "@/lib/task-ui";
import { KPI_KIND_LABEL, KPI_KIND_BADGE, actBonusSummary } from "@/lib/kpi-dto";
import type { KpiOverview, MarkView, MarkDetailView, DriverPayrollView } from "@/lib/kpi-dto";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ShiftHistorySection } from "../_components/shift-history-section";

export function KpiClient({ initialPeriod }: { initialPeriod: string }) {
  const [period, setPeriod] = useState(initialPeriod);
  // Лайв-обновление (доработка №2): экран сам перетягивает картину раз в 20 с, поэтому исправленные
  // нарушения (задача доведена до «Выполнено» / приложен акт) уходят из списка без перезагрузки.
  // Интервал мягче доски (10 с) — экран тяжелее и не такой горячий.
  const { data, mutate, isLoading } = useSWR<KpiOverview>(`/api/kpi/overview?period=${period}`, fetcher, {
    refreshInterval: 20_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  const [manualFor, setManualFor] = useState<DriverPayrollView | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null); // markId для drill-down (№1)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Вечерний обход (02.07): фильтр кандидатов «Все / За сегодня» — Милена разбирает свежие нарушения.
  const [candFilter, setCandFilter] = useState<"all" | "today">("all");

  const closed = data?.closed ?? false;
  // Дата в МСК (вся арифметика KPI московская): «за сегодня» = occurredAt в сегодняшнем дне МСК.
  const todayMsk = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  const isTodayMark = (m: MarkView): boolean =>
    new Date(m.occurredAt).toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" }) === todayMsk;
  const allCandidates = data?.candidates ?? [];
  const todayCount = allCandidates.filter(isTodayMark).length;
  const shownCandidates = candFilter === "today" ? allCandidates.filter(isTodayMark) : allCandidates;
  // Видна ли зарплата (оклад/премия/итог): только админу. Диспетчер видит нарушения и суммы штрафов,
  // но не зарплату — сервер их и не присылает (доработка №10). По умолчанию скрыто, пока не пришёл ответ.
  const payrollVisible = data?.payrollVisible ?? false;

  async function runDetector() {
    setError(null);
    setBusy(true);
    try {
      await apiSend("/api/kpi/detect", "POST");
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function closeMonth() {
    if (!confirm(`Закрыть ${formatPeriod(period)}? Расчёт зафиксируется снимком и больше не изменится.`)) return;
    setError(null);
    setBusy(true);
    try {
      await apiSend(`/api/kpi/periods/${period}/close`, "POST");
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{payrollVisible ? "KPI / Зарплата" : "KPI / Нарушения"}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {payrollVisible
              ? "Кандидаты в нарушения, расчёт по водителям и закрытие месяца."
              : "Кандидаты в нарушения и штрафы по водителям."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="h-9 w-9 px-0" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Предыдущий месяц">
            ◀
          </Button>
          <span className="min-w-36 text-center text-sm font-medium text-neutral-800">{formatPeriod(period)}</span>
          <Button variant="secondary" className="h-9 w-9 px-0" onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Следующий месяц">
            ▶
          </Button>
        </div>
      </div>

      {closed ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Месяц закрыт — расчёт зафиксирован снимком и не меняется при правке отметок.
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {isLoading && !data ? (
        <p className="mt-6 text-sm text-neutral-400">Загрузка…</p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-neutral-900">
                Кандидаты в нарушения{allCandidates.length ? ` · ${allCandidates.length}` : ""}
              </h2>
              {/* Вечерний обход (02.07): быстрый срез свежих нарушений за сегодня. */}
              <div className="flex rounded-lg bg-neutral-100 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setCandFilter("all")}
                  className={`rounded-md px-2.5 py-1 ${
                    candFilter === "all" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
                  }`}
                >
                  Все
                </button>
                <button
                  type="button"
                  onClick={() => setCandFilter("today")}
                  className={`rounded-md px-2.5 py-1 ${
                    candFilter === "today" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
                  }`}
                >
                  За сегодня{todayCount ? ` · ${todayCount}` : ""}
                </button>
              </div>
            </div>
            <Button variant="secondary" className="h-8 px-3 text-xs" disabled={busy} onClick={runDetector}>
              Найти нарушения за сегодня
            </Button>
          </div>
          <CandidatesSection
            candidates={shownCandidates}
            emptyText={
              candFilter === "today" && allCandidates.length > 0
                ? "За сегодня кандидатов нет."
                : undefined
            }
            closed={closed}
            onChanged={() => void mutate()}
            onDetails={setDetailFor}
          />

          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">
                {payrollVisible ? "Расчёт по водителям" : "Нарушения и штрафы по водителям"}
              </h2>
              {!closed && (data?.drivers.length ?? 0) > 0 ? (
                <Button variant="secondary" disabled={busy} onClick={closeMonth}>
                  Закрыть месяц
                </Button>
              ) : null}
            </div>
            {(data?.drivers.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">
                Нет водителей с денежным профилем. Настройте оклад/премию в «Управление → Оплата (KPI)».
              </p>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {data?.drivers.map((d) => (
                  <DriverCard
                    key={d.driverId}
                    driver={d}
                    closed={closed}
                    payrollVisible={payrollVisible}
                    onAddMark={() => setManualFor(d)}
                    onDetails={setDetailFor}
                  />
                ))}
              </div>
            )}
          </section>

          {/* История смен за месяц (перенесена из «Сводки» 06.07): журнал и правка времени открытия/закрытия. */}
          <ShiftHistorySection granularity="month" anchor={`${period}-01`} drivers={data?.drivers ?? []} />
        </>
      )}

      {manualFor ? (
        <ManualMarkModal
          driver={manualFor}
          period={period}
          onClose={() => setManualFor(null)}
          onSaved={() => {
            setManualFor(null);
            void mutate();
          }}
        />
      ) : null}

      {detailFor ? <MarkDetailModal markId={detailFor} onClose={() => setDetailFor(null)} /> : null}
    </main>
  );
}

function CandidatesSection({
  candidates,
  emptyText,
  closed,
  onChanged,
  onDetails,
}: {
  candidates: MarkView[];
  emptyText?: string;
  closed: boolean;
  onChanged: () => void;
  onDetails: (markId: string) => void;
}) {
  if (candidates.length === 0) {
    return (
      <p className="mt-2 text-sm text-neutral-500">
        {emptyText ?? "Новых кандидатов нет — система ничего не нашла."}
      </p>
    );
  }
  return (
    <ul className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {candidates.map((m) => (
        <CandidateRow key={m.id} mark={m} closed={closed} onChanged={onChanged} onDetails={onDetails} />
      ))}
    </ul>
  );
}

function CandidateRow({
  mark,
  closed,
  onChanged,
  onDetails,
}: {
  mark: MarkView;
  closed: boolean;
  onChanged: () => void;
  onDetails: (markId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(status: "CONFIRMED" | "DISMISSED") {
    setError(null);
    setBusy(true);
    try {
      await apiSend(`/api/kpi/marks/${mark.id}/resolve`, "POST", { status });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        {/* Левая зона растёт и обрезается длинным текстом — кнопки справа не «прыгают» (№7, Артём 24.06). */}
        <div className="flex min-w-0 grow flex-wrap items-center gap-x-2 gap-y-1">
          <Badge className={KPI_KIND_BADGE[mark.kind]}>{KPI_KIND_LABEL[mark.kind]}</Badge>
          <span className="text-neutral-500">{formatDate(mark.occurredAt)}</span>
          <span className="font-medium text-neutral-800">{mark.driverName}</span>
          {mark.taskNumber ? (
            <span className="min-w-0 truncate text-neutral-600">
              №{mark.taskNumber} · {mark.taskTitle}
            </span>
          ) : null}
          {mark.note ? <span className="min-w-0 truncate text-neutral-400">{mark.note}</span> : null}
        </div>
        {/* Сумма штрафа за нарушение (доработка №10): тариф из настроек, без прогрессии. */}
        {mark.penaltyAmount != null && mark.penaltyAmount !== 0 ? (
          <span className={cn("shrink-0 font-medium", mark.penaltyAmount < 0 ? "text-green-700" : "text-red-600")}>
            {mark.penaltyAmount < 0 ? "+" : "−"}
            {formatMoney(Math.abs(mark.penaltyAmount))}
          </span>
        ) : null}
        {/* Кнопки — фиксированная группа справа, статичная при любой длине текста. */}
        <span className="flex shrink-0 gap-2">
          {/* Drill-down (№1): разбор нарушения. Доступен всегда, в т.ч. в закрытом месяце. */}
          <Button variant="ghost" className="h-8 px-2 text-xs" disabled={busy} onClick={() => onDetails(mark.id)}>
            Подробнее
          </Button>
          {!closed ? (
            <>
              <Button variant="secondary" className="h-8 px-3" disabled={busy} onClick={() => resolve("CONFIRMED")}>
                Подтвердить
              </Button>
              <Button variant="ghost" className="h-8 px-3" disabled={busy} onClick={() => resolve("DISMISSED")}>
                Отклонить
              </Button>
            </>
          ) : null}
        </span>
      </div>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </li>
  );
}

function DriverCard({
  driver,
  closed,
  payrollVisible,
  onAddMark,
  onDetails,
}: {
  driver: DriverPayrollView;
  closed: boolean;
  payrollVisible: boolean;
  onAddMark: () => void;
  onDetails: (markId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Итог штрафов по водителю для диспетчера (доработка №10): тарифы авто-нарушений + ручные штрафы.
  // Поощрения (ручные +) в сумму штрафов не входят. У админа итог считается в зарплате (driver.penalty).
  const penaltyTotal = driver.marks.reduce((s, m) => {
    if (m.kind === "MANUAL") return s + (m.manualAmount != null && m.manualAmount < 0 ? -m.manualAmount : 0);
    return s + (m.penaltyAmount ?? 0);
  }, 0);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900">{driver.driverName}</span>
        {!payrollVisible ? (
          <span className={cn("text-sm font-medium", penaltyTotal > 0 ? "text-red-600" : "text-neutral-400")}>
            {penaltyTotal > 0 ? `Штрафы −${formatMoney(penaltyTotal)}` : "Без штрафов"}
          </span>
        ) : null}
      </div>

      {/* Зарплатный расчёт — только для админа (доработка №10). Диспетчер видит лишь нарушения/штрафы. */}
      {payrollVisible ? (
        <>
          {/* Вариант B (Артём 24.06): крупные карточки-цифры + цветные пилюли вместо «радуги» баров. */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Metric label="К выплате" value={formatMoney(driver.total)} accent />
            <Metric label="Оклад" value={formatMoney(driver.baseSalary)} />
            <Metric label="Премия" value={formatMoney(driver.premiumBase)} />
          </div>
          {driver.penalty > 0 || driver.bonus > 0 || driver.actBonus.value > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {driver.penalty > 0 ? <Pill tone="red">Штрафы −{formatMoney(driver.penalty)}</Pill> : null}
              {driver.bonus > 0 ? <Pill tone="green">Поощрения +{formatMoney(driver.bonus)}</Pill> : null}
              {driver.actBonus.value > 0 ? (
                <Pill tone="green">Бонус за акты +{formatMoney(driver.actBonus.value)}</Pill>
              ) : null}
            </div>
          ) : null}

          {/* Прогресс бонуса за комплектность актов (этап 15, PRD §12.6) */}
          {driver.actBonus.base > 0 || driver.actBonus.value > 0 ? <ActBonusLine driver={driver} /> : null}
        </>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen((v) => !v)}>
          {open ? "Скрыть детали" : `Детали (${driver.marks.length})`}
        </Button>
        {!closed ? (
          <Button variant="secondary" className="h-8 px-3 text-xs" onClick={onAddMark}>
            + Отметка / поощрение
          </Button>
        ) : null}
      </div>

      {open ? (
        driver.marks.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">
            {payrollVisible ? "Нарушений и отметок нет — полная премия." : "Нарушений и отметок нет."}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100 text-sm">
            {driver.marks.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge className={KPI_KIND_BADGE[m.kind]}>{KPI_KIND_LABEL[m.kind]}</Badge>
                  <span className="text-neutral-500">{formatDate(m.occurredAt)}</span>
                  {m.taskNumber ? <span className="text-neutral-600">№{m.taskNumber}</span> : null}
                  {m.note ? <span className="truncate text-neutral-400">{m.note}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {m.kind === "MANUAL" && m.manualAmount != null ? (
                    <span className={m.manualAmount >= 0 ? "text-green-700" : "text-red-600"}>
                      {m.manualAmount >= 0 ? "+" : "−"}
                      {formatMoney(Math.abs(m.manualAmount))}
                    </span>
                  ) : m.penaltyAmount != null && m.penaltyAmount !== 0 ? (
                    <span className="text-red-600">−{formatMoney(Math.abs(m.penaltyAmount))}</span>
                  ) : null}
                  <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => onDetails(m.id)}>
                    Подробнее
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** Метрик-карта (вариант B): крупное число с подписью. accent — акцентная «К выплате» (графит). */
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg p-2.5", accent ? "bg-neutral-900" : "bg-neutral-50")}>
      <div className={cn("text-xs", accent ? "text-neutral-300" : "text-neutral-500")}>{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", accent ? "text-white" : "text-neutral-900")}>
        {value}
      </div>
    </div>
  );
}

/** Цветная пилюля: штрафы (красная) и поощрения/бонусы (зелёная). Показываются только ненулевые. */
function Pill({ tone, children }: { tone: "red" | "green"; children: ReactNode }) {
  const cls = tone === "red" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700";
  return <span className={cn("rounded-md px-2.5 py-1 text-xs font-medium", cls)}>{children}</span>;
}

function ActBonusLine({ driver }: { driver: DriverPayrollView }) {
  const ab = driver.actBonus;
  const s = actBonusSummary(ab);
  const tone =
    s.tone === "green"
      ? "border-green-200 bg-green-50 text-green-800"
      : s.tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-neutral-200 bg-neutral-50 text-neutral-600";
  const fillPct = ab.base > 0 ? Math.min(100, (ab.complete / ab.base) * 100) : 0;
  const fill = ab.awarded ? "bg-green-500" : "bg-amber-400";
  return (
    <div className="mt-2">
      <p className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${tone}`}>{s.text}</p>
      {ab.base > 0 ? (
        <div className="mt-2 px-0.5">
          <div className="relative h-2.5 rounded bg-neutral-100">
            <div className={cn("h-full rounded", fill)} style={{ width: `${fillPct}%` }} />
            <div
              className="absolute top-[-2px] h-[14px] w-px bg-neutral-500"
              style={{ left: `${ab.thresholdPercent}%` }}
              aria-hidden
            />
          </div>
          <div className="relative mt-1 h-3.5">
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-neutral-400"
              style={{ left: `${ab.thresholdPercent}%` }}
            >
              порог {ab.thresholdPercent}%
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ManualMarkModal({
  driver,
  period,
  onClose,
  onSaved,
}: {
  driver: DriverPayrollView;
  period: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sign, setSign] = useState<"penalty" | "bonus">("bonus");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = Math.trunc(Number(amount));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Введите положительную сумму");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await apiSend("/api/kpi/marks", "POST", {
        driverId: driver.driverId,
        amount: sign === "penalty" ? -value : value,
        note: note.trim() || undefined,
        period,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Отметка — ${driver.driverName}`}>
      <div className="flex flex-col gap-3">
        <Field label="Тип">
          <Select value={sign} onChange={(e) => setSign(e.target.value as "penalty" | "bonus")}>
            <option value="bonus">Поощрение (+)</option>
            <option value="penalty">Штраф (−)</option>
          </Select>
        </Field>
        <Field label="Сумма, ₽" required>
          <Input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="например, 5000"
            autoFocus
          />
        </Field>
        <Field label="Комментарий" hint="За что отметка (видно в расчёте)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={save}>
            Сохранить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const MARK_STATUS_LABEL: Record<string, string> = {
  CANDIDATE: "Кандидат (не разобран)",
  CONFIRMED: "Подтверждено",
  DISMISSED: "Отклонено",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fmtMinutes(min: number | null): string {
  if (min == null) return "—";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right font-medium text-neutral-800">{value}</span>
    </div>
  );
}

/** Drill-down (№1): карточка нарушения с разбором «почему засчиталось». Грузит детали по требованию. */
function MarkDetailModal({ markId, onClose }: { markId: string; onClose: () => void }) {
  const { data, isLoading } = useSWR<MarkDetailView>(`/api/kpi/marks/${markId}`, fetcher);
  const title = data ? KPI_KIND_LABEL[data.kind] : "Нарушение";
  return (
    <Modal open onClose={onClose} title={`Нарушение — ${title}`}>
      {isLoading && !data ? (
        <p className="text-sm text-neutral-400">Загрузка…</p>
      ) : !data ? (
        <p className="text-sm text-red-600">Не удалось загрузить детали.</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <DetailRow label="Водитель" value={data.driverName} />
          <DetailRow label="Дата" value={formatDate(data.occurredAt)} />
          <DetailRow label="Статус отметки" value={MARK_STATUS_LABEL[data.status] ?? data.status} />
          {data.penaltyAmount != null && data.penaltyAmount !== 0 ? (
            <DetailRow
              label="Сумма штрафа"
              value={`${data.penaltyAmount < 0 ? "+" : "−"}${formatMoney(Math.abs(data.penaltyAmount))}`}
            />
          ) : null}

          {/* «Поздно открыл смену» — разбор по смене */}
          {data.kind === "SHIFT_LATE" ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-neutral-600">
              <p className="mb-1 font-medium text-neutral-800">Почему засчиталось</p>
              <p>
                Смена открыта в {fmtTime(data.shiftOpenedAt)}, порог — {fmtMinutes(data.shiftThresholdMinutes)}.
                Открытие позже порога засчитывается как «поздно открыл смену».
              </p>
              <p className="mt-1 text-neutral-500">
                Приход {data.shiftConfirmedAt ? `подтверждён в ${fmtTime(data.shiftConfirmedAt)}` : "ещё не подтверждён"}.
              </p>
            </div>
          ) : null}

          {/* «Без акта» / «Невыполненная точка» — разбор по задаче + переход в карточку */}
          {data.taskId ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-neutral-600">
              <p className="mb-1 font-medium text-neutral-800">
                Задача №{data.taskNumber} · {data.taskTitle}
              </p>
              {data.kind === "UNSIGNED_DOCS" ? (
                <>
                  <p>
                    Завершена{data.taskCompletedAt ? ` ${formatDate(data.taskCompletedAt)}` : ""}, акт требовался.
                    {data.actDeadlineAt
                      ? ` Дедлайн акта — ${fmtTime(data.actDeadlineAt)} ${formatDate(data.actDeadlineAt)}.`
                      : ""}
                  </p>
                  <p className="mt-1">
                    {data.docAttachedAt
                      ? `Акт приложен ${formatDate(data.docAttachedAt)} в ${fmtTime(data.docAttachedAt)}${
                          data.actDeadlineAt && data.docAttachedAt > data.actDeadlineAt ? " — после дедлайна" : ""
                        }.`
                      : "Акт не приложен."}
                  </p>
                  {data.actMissedReason ? (
                    <p className="mt-1 text-amber-700">Причина водителя: {data.actMissedReason}</p>
                  ) : null}
                </>
              ) : null}
              {data.kind === "MISSED_STOP" ? (
                <p>
                  Запланирована на {data.taskScheduledDate ? formatDate(data.taskScheduledDate) : "—"}, не доведена до
                  «Выполнено» (статус: {data.taskStatus ? STATUS_LABEL[data.taskStatus] : "—"}).
                </p>
              ) : null}
              <Link href={`/tasks/${data.taskId}`} className="mt-2 inline-block font-medium text-blue-600 hover:underline">
                Открыть задачу →
              </Link>
            </div>
          ) : null}

          {/* Ручная отметка */}
          {data.kind === "MANUAL" ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-neutral-600">
              {data.manualAmount != null ? (
                <p className="text-neutral-700">
                  {data.manualAmount >= 0 ? "Поощрение" : "Штраф"}: {data.manualAmount >= 0 ? "+" : "−"}
                  {formatMoney(Math.abs(data.manualAmount))}
                </p>
              ) : null}
              {data.note ? <p className="mt-1">{data.note}</p> : null}
              {data.createdByName ? <p className="mt-1 text-neutral-500">Завёл: {data.createdByName}</p> : null}
            </div>
          ) : null}

          {/* Кто и когда разобрал */}
          {data.resolvedByName || data.resolvedAt ? (
            <DetailRow
              label={data.status === "DISMISSED" ? "Отклонил" : "Подтвердил"}
              value={`${data.resolvedByName ?? "—"}${data.resolvedAt ? ` · ${formatDate(data.resolvedAt)}` : ""}`}
            />
          ) : null}

          <div className="mt-1 flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

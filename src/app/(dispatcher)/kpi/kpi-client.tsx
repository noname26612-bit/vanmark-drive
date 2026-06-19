"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, apiSend } from "@/lib/fetcher";
import { cn } from "@/lib/cn";
import { formatMoney, formatDate, formatPeriod, shiftPeriod } from "@/lib/task-ui";
import { KPI_KIND_LABEL, KPI_KIND_BADGE, actBonusSummary } from "@/lib/kpi-dto";
import type { KpiOverview, MarkView, DriverPayrollView } from "@/lib/kpi-dto";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function KpiClient({ initialPeriod }: { initialPeriod: string }) {
  const [period, setPeriod] = useState(initialPeriod);
  const { data, mutate, isLoading } = useSWR<KpiOverview>(`/api/kpi/overview?period=${period}`, fetcher);
  const [manualFor, setManualFor] = useState<DriverPayrollView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = data?.closed ?? false;

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
          <h1 className="text-2xl font-semibold text-neutral-900">KPI / Зарплата</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Кандидаты в нарушения, расчёт по водителям и закрытие месяца.
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
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">
              Кандидаты в нарушения{data?.candidates.length ? ` · ${data.candidates.length}` : ""}
            </h2>
            <Button variant="secondary" className="h-8 px-3 text-xs" disabled={busy} onClick={runDetector}>
              Найти нарушения за сегодня
            </Button>
          </div>
          <CandidatesSection candidates={data?.candidates ?? []} closed={closed} onChanged={() => void mutate()} />

          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">Расчёт по водителям</h2>
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
                  <DriverCard key={d.driverId} driver={d} closed={closed} onAddMark={() => setManualFor(d)} />
                ))}
              </div>
            )}
          </section>
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
    </main>
  );
}

function CandidatesSection({
  candidates,
  closed,
  onChanged,
}: {
  candidates: MarkView[];
  closed: boolean;
  onChanged: () => void;
}) {
  if (candidates.length === 0) {
    return <p className="mt-2 text-sm text-neutral-500">Новых кандидатов нет — система ничего не нашла.</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {candidates.map((m) => (
        <CandidateRow key={m.id} mark={m} closed={closed} onChanged={onChanged} />
      ))}
    </ul>
  );
}

function CandidateRow({ mark, closed, onChanged }: { mark: MarkView; closed: boolean; onChanged: () => void }) {
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
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
      <Badge className={KPI_KIND_BADGE[mark.kind]}>{KPI_KIND_LABEL[mark.kind]}</Badge>
      <span className="text-neutral-500">{formatDate(mark.occurredAt)}</span>
      <span className="font-medium text-neutral-800">{mark.driverName}</span>
      {mark.taskNumber ? (
        <span className="text-neutral-600">
          №{mark.taskNumber} · {mark.taskTitle}
        </span>
      ) : null}
      <span className="grow text-neutral-400">{mark.note}</span>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      {!closed ? (
        <span className="flex gap-2">
          <Button variant="secondary" className="h-8 px-3" disabled={busy} onClick={() => resolve("CONFIRMED")}>
            Подтвердить
          </Button>
          <Button variant="ghost" className="h-8 px-3" disabled={busy} onClick={() => resolve("DISMISSED")}>
            Отклонить
          </Button>
        </span>
      ) : null}
    </li>
  );
}

function DriverCard({
  driver,
  closed,
  onAddMark,
}: {
  driver: DriverPayrollView;
  closed: boolean;
  onAddMark: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900">{driver.driverName}</span>
        <span className="text-lg font-semibold text-neutral-900">{formatMoney(driver.total)}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-neutral-600">
        <span>Оклад</span>
        <span className="text-right">{formatMoney(driver.baseSalary)}</span>
        <span>Премия</span>
        <span className="text-right">{formatMoney(driver.premiumBase)}</span>
        <span>Штрафы</span>
        <span className={`text-right ${driver.penalty > 0 ? "text-red-600" : ""}`}>
          {driver.penalty > 0 ? `−${formatMoney(driver.penalty)}` : "—"}
        </span>
        <span>Поощрения</span>
        <span className={`text-right ${driver.bonus > 0 ? "text-green-700" : ""}`}>
          {driver.bonus > 0 ? `+${formatMoney(driver.bonus)}` : "—"}
        </span>
        <span>Бонус за акты</span>
        <span className={`text-right ${driver.actBonus.value > 0 ? "text-green-700" : ""}`}>
          {driver.actBonus.value > 0 ? `+${formatMoney(driver.actBonus.value)}` : "—"}
        </span>
      </div>

      <PayoutBar driver={driver} />
      <PremiumBar driver={driver} />

      {/* Прогресс бонуса за комплектность актов (этап 15, PRD §12.6) */}
      {driver.actBonus.base > 0 || driver.actBonus.value > 0 ? <ActBonusLine driver={driver} /> : null}

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
          <p className="mt-2 text-sm text-neutral-400">Нарушений и отметок нет — полная премия.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100 text-sm">
            {driver.marks.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex items-center gap-2">
                  <Badge className={KPI_KIND_BADGE[m.kind]}>{KPI_KIND_LABEL[m.kind]}</Badge>
                  <span className="text-neutral-500">{formatDate(m.occurredAt)}</span>
                  {m.taskNumber ? <span className="text-neutral-600">№{m.taskNumber}</span> : null}
                  {m.note ? <span className="text-neutral-400">{m.note}</span> : null}
                </span>
                {m.kind === "MANUAL" && m.manualAmount != null ? (
                  <span className={m.manualAmount >= 0 ? "text-green-700" : "text-red-600"}>
                    {m.manualAmount >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(m.manualAmount))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** Полоса состава итоговой выплаты: оклад + премия (после штрафов) + поощрения + бонус за акты. */
function PayoutBar({ driver }: { driver: DriverPayrollView }) {
  const premium = Math.max(0, driver.premiumAfter);
  const segs = [
    { key: "salary", label: "Оклад", value: driver.baseSalary, cls: "bg-neutral-400" },
    { key: "premium", label: "Премия", value: premium, cls: "bg-green-600" },
    { key: "bonus", label: "Поощрения", value: driver.bonus, cls: "bg-green-400" },
    { key: "act", label: "Бонус за акты", value: driver.actBonus.value, cls: "bg-green-300" },
  ].filter((s) => s.value > 0);
  const total = segs.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-xs text-neutral-500">Из чего складывается итог</div>
      <div className="flex h-3 overflow-hidden rounded bg-neutral-100">
        {segs.map((s) => (
          <div key={s.key} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-sm", s.cls)} />
            {s.label} {formatMoney(s.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Шкала премии: сколько осталось (зелёным) и сколько съели штрафы (красным). Показываем только при штрафах. */
function PremiumBar({ driver }: { driver: DriverPayrollView }) {
  if (driver.penalty <= 0 || driver.premiumBase <= 0) return null;
  const kept = Math.max(0, Math.min(driver.premiumBase, driver.premiumAfter));
  const eaten = Math.min(driver.premiumBase, driver.penalty);
  const keptPct = (kept / driver.premiumBase) * 100;
  const eatenPct = (eaten / driver.premiumBase) * 100;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-neutral-500">Премия после штрафов</span>
        <span className="text-red-600">штрафы −{formatMoney(driver.penalty)}</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded bg-neutral-100">
        <div className="bg-green-600" style={{ width: `${keptPct}%` }} />
        <div className="bg-red-400" style={{ width: `${eatenPct}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {formatMoney(kept)} из {formatMoney(driver.premiumBase)}
      </div>
    </div>
  );
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

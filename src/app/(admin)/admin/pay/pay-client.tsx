"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, apiSend } from "@/lib/fetcher";
import { KPI_KIND_LABEL } from "@/lib/kpi-dto";
import type { PayProfileView, KpiRuleView, KpiSettingsView } from "@/lib/kpi-dto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";

export function PayClient() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Администрирование
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-neutral-900">Оплата (KPI)</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Оклад и премия каждого водителя, веса штрафов и прогрессия. Влияет на расчёт открытых месяцев;
        закрытые месяцы зафиксированы снимком и не пересчитываются.
      </p>

      <ProfilesSection />
      <RulesSection />
      <SettingsSection />
    </main>
  );
}

function ProfilesSection() {
  const { data, mutate } = useSWR<PayProfileView[]>("/api/admin/pay-profiles", fetcher);
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-neutral-900">Оклад и премия</h2>
      <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs text-neutral-400">
            <tr>
              <th className="px-3 py-2">Водитель</th>
              <th className="px-3 py-2">Оклад, ₽</th>
              <th className="px-3 py-2">Премия, ₽</th>
              <th className="px-3 py-2">Учитывать</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data?.map((p) => <ProfileRow key={p.driverId} profile={p} onSaved={() => void mutate()} />)}
          </tbody>
        </table>
      </div>
      {data && data.length === 0 ? <p className="mt-2 text-sm text-neutral-500">Водителей нет.</p> : null}
    </section>
  );
}

function ProfileRow({ profile, onSaved }: { profile: PayProfileView; onSaved: () => void }) {
  const [baseSalary, setBaseSalary] = useState(String(profile.baseSalary));
  const [premiumBase, setPremiumBase] = useState(String(profile.premiumBase));
  const [isActive, setIsActive] = useState(profile.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    Number(baseSalary) !== profile.baseSalary ||
    Number(premiumBase) !== profile.premiumBase ||
    isActive !== profile.isActive;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await apiSend("/api/admin/pay-profiles", "PUT", {
        driverId: profile.driverId,
        baseSalary: Math.trunc(Number(baseSalary)) || 0,
        premiumBase: Math.trunc(Number(premiumBase)) || 0,
        isActive,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="px-3 py-2 font-medium text-neutral-800">
        {profile.driverName}
        {error ? <span className="block text-xs text-red-600">{error}</span> : null}
      </td>
      <td className="px-3 py-2">
        <Input type="number" min={0} value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} className="h-8 w-28" />
      </td>
      <td className="px-3 py-2">
        <Input type="number" min={0} value={premiumBase} onChange={(e) => setPremiumBase(e.target.value)} className="h-8 w-28" />
      </td>
      <td className="px-3 py-2">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
      </td>
      <td className="px-3 py-2 text-right">
        <Button variant="secondary" disabled={!dirty || busy} onClick={save} className="h-8 px-3">
          Сохранить
        </Button>
      </td>
    </tr>
  );
}

function RulesSection() {
  const { data, mutate } = useSWR<KpiRuleView[]>("/api/admin/kpi-rules", fetcher);
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-neutral-900">Веса штрафов</h2>
      <p className="mt-1 text-sm text-neutral-500">Базовая сумма штрафа за одно нарушение (до прогрессии).</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {data?.map((r) => <RuleCard key={r.kind} rule={r} onSaved={() => void mutate()} />)}
      </div>
    </section>
  );
}

function RuleCard({ rule, onSaved }: { rule: KpiRuleView; onSaved: () => void }) {
  const [weight, setWeight] = useState(String(rule.weight));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = Number(weight) !== rule.weight;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await apiSend("/api/admin/kpi-rules", "PUT", { kind: rule.kind, weight: Math.trunc(Number(weight)) || 0 });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="text-sm font-medium text-neutral-800">{KPI_KIND_LABEL[rule.kind]}</div>
      <div className="mt-2 flex items-center gap-2">
        <Input type="number" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} className="h-8 w-24" />
        <span className="text-sm text-neutral-400">₽</span>
        <Button variant="secondary" disabled={!dirty || busy} onClick={save} className="ml-auto h-8 px-3">
          ОК
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function SettingsSection() {
  const { data, mutate } = useSWR<KpiSettingsView>("/api/admin/kpi-settings", fetcher);
  const [percent, setPercent] = useState<string | null>(null);
  const [startIndex, setStartIndex] = useState<string | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [bonusAmount, setBonusAmount] = useState<string | null>(null);
  const [bonusThreshold, setBonusThreshold] = useState<string | null>(null);
  const [normHours, setNormHours] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <section className="mt-8 text-sm text-neutral-400">Загрузка настроек…</section>;

  const percentVal = percent ?? String(data.progressionPercent);
  const startVal = startIndex ?? String(data.progressionStartIndex);
  const floorVal = floor ?? data.floor;
  const bonusAmountVal = bonusAmount ?? String(data.actBonusAmount);
  const bonusThresholdVal = bonusThreshold ?? String(data.actBonusThresholdPercent);
  const normHoursVal = normHours ?? String(data.monthNormHours);
  const dirty =
    Number(percentVal) !== data.progressionPercent ||
    Number(startVal) !== data.progressionStartIndex ||
    floorVal !== data.floor ||
    Number(bonusAmountVal) !== data.actBonusAmount ||
    Number(bonusThresholdVal) !== data.actBonusThresholdPercent ||
    Number(normHoursVal) !== data.monthNormHours;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await apiSend("/api/admin/kpi-settings", "PUT", {
        progressionPercent: Math.trunc(Number(percentVal)),
        progressionStartIndex: Math.trunc(Number(startVal)),
        floor: floorVal,
        actBonusAmount: Math.trunc(Number(bonusAmountVal)),
        actBonusThresholdPercent: Math.trunc(Number(bonusThresholdVal)),
        monthNormHours: Math.trunc(Number(normHoursVal)),
      });
      setPercent(null);
      setStartIndex(null);
      setFloor(null);
      setBonusAmount(null);
      setBonusThreshold(null);
      setNormHours(null);
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-neutral-900">Прогрессия, порог и бонус за акты</h2>
      <div className="mt-2 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <Field label="Шаг прогрессии, %" hint="110 = каждая следующая ошибка на 10% дороже">
          <Input type="number" min={100} value={percentVal} onChange={(e) => setPercent(e.target.value)} />
        </Field>
        <Field label="Прогрессия с какой ошибки" hint="3 = первые две без надбавки">
          <Input type="number" min={1} value={startVal} onChange={(e) => setStartIndex(e.target.value)} />
        </Field>
        <Field label="Нижний порог итога" hint="Куда максимум опускают штрафы">
          <Select value={floorVal} onChange={(e) => setFloor(e.target.value)}>
            <option value="SALARY">Не ниже оклада (штрафы максимум обнуляют премию)</option>
            <option value="ZERO">Может уйти ниже оклада (не ниже 0)</option>
          </Select>
        </Field>
        <div />
        <Field label="Бонус за комплектность актов, ₽" hint="5000 = +5000 ₽ при достижении порога; 0 — выключить">
          <Input type="number" min={0} value={bonusAmountVal} onChange={(e) => setBonusAmount(e.target.value)} />
        </Field>
        <Field label="Порог комплектности актов, %" hint="80 = бонус при ≥80% актовых задач с актом">
          <Input type="number" min={1} max={100} value={bonusThresholdVal} onChange={(e) => setBonusThreshold(e.target.value)} />
        </Field>
        <Field label="Нормо-часы месяца" hint="176 = 8 ч × 22 дня; для цены простоя в Сводке (видна админу)">
          <Input type="number" min={1} max={400} value={normHoursVal} onChange={(e) => setNormHours(e.target.value)} />
        </Field>
        <div className="flex items-end sm:col-span-2">
          <Button disabled={!dirty || busy} onClick={save}>
            Сохранить
          </Button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </section>
  );
}

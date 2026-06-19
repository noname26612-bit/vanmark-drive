"use client";

import { useState } from "react";
import Link from "next/link";
import { apiSend } from "@/lib/fetcher";
import { parseHhMm } from "@/domain/capacity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";

type Settings = {
  baseLat: number;
  baseLng: number;
  workdayMinutes: number;
  avgSpeedKmh: number;
  detourPercent: number;
  countReturnTrip: boolean;
};
type WindowRow = { from: string; to: string; factor: string };
type Driver = {
  id: string;
  name: string;
  login: string;
  specialization: "REPAIR" | "DELIVERY" | "ANY";
  isActive: boolean;
};

const SPEC_LABEL: Record<Driver["specialization"], string> = {
  REPAIR: "Ремонты",
  DELIVERY: "Доставки",
  ANY: "Любые",
};

function hhmm(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

export function CapacityClient({
  initialSettings,
  initialWindows,
  initialDrivers,
}: {
  initialSettings: Settings;
  initialWindows: { fromMinutes: number; toMinutes: number; factorPercent: number }[];
  initialDrivers: Driver[];
}) {
  const [s, setS] = useState<Settings>(initialSettings);
  const [specMap, setSpecMap] = useState<Record<string, Driver["specialization"]>>(
    Object.fromEntries(initialDrivers.map((d) => [d.id, d.specialization])),
  );
  const [windows, setWindows] = useState<WindowRow[]>(
    initialWindows.map((w) => ({ from: hhmm(w.fromMinutes), to: hhmm(w.toMinutes), factor: String(w.factorPercent) })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const num = (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS((prev) => ({ ...prev, [key]: Number(e.target.value) }));

  async function saveSettings() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await apiSend("/api/admin/capacity-settings", "PUT", { settings: s, specializations: specMap });
      setMsg("Настройки и специализация сохранены");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveWindows() {
    setErr(null);
    setMsg(null);
    const parsed: { fromMinutes: number; toMinutes: number; factorPercent: number }[] = [];
    for (const w of windows) {
      const from = parseHhMm(w.from);
      const to = parseHhMm(w.to);
      const factor = Number.parseInt(w.factor, 10);
      if (from === null || to === null || !Number.isFinite(factor)) {
        setErr("Проверьте окна: время в формате ЧЧ:ММ, коэффициент — число (%)");
        return;
      }
      if (from >= to) {
        setErr(`Окно ${w.from}–${w.to}: начало должно быть раньше конца`);
        return;
      }
      parsed.push({ fromMinutes: from, toMinutes: to, factorPercent: factor });
    }
    setBusy(true);
    try {
      await apiSend("/api/admin/traffic-windows", "PUT", { windows: parsed });
      setMsg("Окна пробок сохранены");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const setWin = (i: number, key: keyof WindowRow, value: string) =>
    setWindows((prev) => prev.map((w, idx) => (idx === i ? { ...w, [key]: value } : w)));
  const addWin = () => setWindows((prev) => [...prev, { from: "", to: "", factor: "100" }]);
  const removeWin = (i: number) => setWindows((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Администрирование
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-neutral-900">Календарь загрузки — настройки</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Параметры расчёта оценки времени задач (PRD §14). Оценка = норма типа (в «Типах задач») +
        дорога: расстояние от базы × петляние ÷ скорость × коэффициент пробок по времени выезда.
      </p>

      {/* Настройки расчёта */}
      <section className="mt-5 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Расчёт дороги</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Широта базы">
            <Input type="number" step="0.000001" value={s.baseLat} onChange={num("baseLat")} />
          </Field>
          <Field label="Долгота базы">
            <Input type="number" step="0.000001" value={s.baseLng} onChange={num("baseLng")} />
          </Field>
          <Field label="Рабочий день, мин (за вычетом обеда)">
            <Input type="number" min={1} value={s.workdayMinutes} onChange={num("workdayMinutes")} />
          </Field>
          <Field label="Средняя скорость, км/ч">
            <Input type="number" min={1} value={s.avgSpeedKmh} onChange={num("avgSpeedKmh")} />
          </Field>
          <Field label="Петляние дорог, % (110 = ×1.1)">
            <Input type="number" min={100} value={s.detourPercent} onChange={num("detourPercent")} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={s.countReturnTrip}
              onChange={(e) => setS((prev) => ({ ...prev, countReturnTrip: e.target.checked }))}
              className="h-4 w-4"
            />
            Учитывать обратную дорогу (×2)
          </label>
        </div>

        {/* Специализация водителей */}
        <h2 className="mt-5 mb-2 text-sm font-semibold text-neutral-700">Специализация водителей</h2>
        <p className="mb-2 text-xs text-neutral-500">
          Для подсказки «кто свободен» в календаре. Не ограничивает назначение.
        </p>
        <div className="flex flex-col gap-2">
          {initialDrivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2">
              <span className="text-sm text-neutral-800">
                {d.name}
                {d.isActive ? "" : " (неактивен)"}
              </span>
              <Select
                value={specMap[d.id]}
                onChange={(e) =>
                  setSpecMap((prev) => ({ ...prev, [d.id]: e.target.value as Driver["specialization"] }))
                }
                className="w-40"
              >
                {(["REPAIR", "DELIVERY", "ANY"] as const).map((v) => (
                  <option key={v} value={v}>
                    {SPEC_LABEL[v]}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>

        <Button className="mt-4" disabled={busy} onClick={saveSettings} data-testid="save-capacity-settings">
          Сохранить настройки
        </Button>
      </section>

      {/* Окна пробок */}
      <section className="mt-5 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-neutral-700">Коэффициенты пробок по времени суток</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Множитель времени в пути по окну выезда (100 = ×1.0, 140 = ×1.4). Окна не должны пересекаться.
        </p>
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs text-neutral-400">
              <tr>
                <th className="px-3 py-2">С (ЧЧ:ММ)</th>
                <th className="px-3 py-2">До (ЧЧ:ММ)</th>
                <th className="px-3 py-2">Коэффициент, %</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {windows.map((w, i) => (
                <tr key={i} className="border-b border-neutral-100 last:border-0">
                  <td className="px-3 py-2">
                    <Input value={w.from} onChange={(e) => setWin(i, "from", e.target.value)} placeholder="08:00" className="h-8 w-24" />
                  </td>
                  <td className="px-3 py-2">
                    <Input value={w.to} onChange={(e) => setWin(i, "to", e.target.value)} placeholder="09:30" className="h-8 w-24" />
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" value={w.factor} onChange={(e) => setWin(i, "factor", e.target.value)} className="h-8 w-24" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" className="h-8 px-2" onClick={() => removeWin(i)}>
                      Удалить
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" onClick={addWin}>
            + Окно
          </Button>
          <Button disabled={busy} onClick={saveWindows} data-testid="save-traffic-windows">
            Сохранить окна
          </Button>
        </div>
      </section>

      {msg ? <p className="mt-3 text-sm text-green-700">{msg}</p> : null}
      {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}
    </main>
  );
}

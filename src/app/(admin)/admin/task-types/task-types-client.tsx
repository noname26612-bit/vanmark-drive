"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, apiSend } from "@/lib/fetcher";
import type { TaskTypeFullDTO } from "@/lib/task-dto";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TaskTypesClient({ initial }: { initial: TaskTypeFullDTO[] }) {
  const { data: types = initial, mutate } = useSWR<TaskTypeFullDTO[]>(
    "/api/admin/task-types",
    fetcher,
    { fallbackData: initial },
  );
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addType() {
    if (!newName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await apiSend("/api/admin/task-types", "POST", {
        name: newName.trim(),
        sortOrder: types.length + 1,
      });
      setNewName("");
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Администрирование
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-neutral-900">Типы задач</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Влияет на форму создания. Фото — везде по желанию; требование акта берётся из типа и
        задаётся на конкретной заявке (PRD §3–§4). «Норма, мин» — среднее время работы на объекте
        для оценки загрузки (Фаза 2, PRD §14); к нему прибавляется дорога.
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs text-neutral-400">
            <tr>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Норма, мин</th>
              <th className="px-3 py-2">Акт по умолчанию</th>
              <th className="px-3 py-2">Активен</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <TypeRow key={t.id} type={t} onSaved={() => void mutate()} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-neutral-300 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Новый тип</span>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название типа"
            className="w-64"
          />
        </label>
        <Button disabled={busy || !newName.trim()} onClick={addType}>
          Добавить
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </main>
  );
}

function TypeRow({ type, onSaved }: { type: TaskTypeFullDTO; onSaved: () => void }) {
  const [name, setName] = useState(type.name);
  const [isActive, setIsActive] = useState(type.isActive);
  const [onSiteMinutes, setOnSiteMinutes] = useState(String(type.onSiteMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== type.name || isActive !== type.isActive || onSiteMinutes !== String(type.onSiteMinutes);

  async function save() {
    setError(null);
    const minutes = Number.parseInt(onSiteMinutes, 10);
    if (!Number.isFinite(minutes) || minutes < 0) {
      setError("Норма должна быть числом ≥ 0");
      return;
    }
    setBusy(true);
    try {
      await apiSend(`/api/admin/task-types/${type.id}`, "PATCH", { name, isActive, onSiteMinutes: minutes });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="px-3 py-2">
        <span className="flex items-center gap-2">
          <TypeIcon name={type.icon} className="h-4 w-4 text-neutral-400" />
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-56" />
        </span>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          min={0}
          value={onSiteMinutes}
          onChange={(e) => setOnSiteMinutes(e.target.value)}
          className="h-8 w-20"
        />
      </td>
      <td className="px-3 py-2">
        {type.requiresSignedDoc ? (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">да</span>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <Button variant="secondary" disabled={!dirty || busy} onClick={save} className="h-8 px-3">
          Сохранить
        </Button>
      </td>
    </tr>
  );
}

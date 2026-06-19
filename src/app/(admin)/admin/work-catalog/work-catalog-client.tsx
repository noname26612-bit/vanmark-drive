"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, apiSend } from "@/lib/fetcher";
import type { WorkCatalogFullDTO } from "@/lib/task-dto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WorkCatalogClient({ initial }: { initial: WorkCatalogFullDTO[] }) {
  const { data: items = initial, mutate } = useSWR<WorkCatalogFullDTO[]>(
    "/api/admin/work-catalog",
    fetcher,
    { fallbackData: initial },
  );
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!newName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await apiSend("/api/admin/work-catalog", "POST", {
        name: newName.trim(),
        sortOrder: items.length + 1,
        defaultPrice: newPrice.trim() === "" ? null : Math.trunc(Number(newPrice)) || 0,
      });
      setNewName("");
      setNewPrice("");
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
      <h1 className="mt-2 text-2xl font-semibold text-neutral-900">Работы (для ведомости)</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Справочник работ, из которого водитель выбирает позиции ведомости при выездном ремонте (PRD §13).
        Цена-подсказка помогает диспетчеру при расценке (он правит цену под случай). Водитель цен не видит.
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs text-neutral-400">
            <tr>
              <th className="px-3 py-2">Работа</th>
              <th className="px-3 py-2">Цена-подсказка, ₽</th>
              <th className="px-3 py-2">Активна</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <Row key={it.id} item={it} onSaved={() => void mutate()} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-neutral-300 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Новая работа</span>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название работы"
            className="w-64"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Цена-подсказка, ₽</span>
          <Input
            type="number"
            min={0}
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="без цены"
            className="w-32"
          />
        </label>
        <Button disabled={busy || !newName.trim()} onClick={add}>
          Добавить
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </main>
  );
}

function Row({ item, onSaved }: { item: WorkCatalogFullDTO; onSaved: () => void }) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.defaultPrice != null ? String(item.defaultPrice) : "");
  const [isActive, setIsActive] = useState(item.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceVal = price.trim() === "" ? null : Math.trunc(Number(price)) || 0;
  const dirty = name !== item.name || isActive !== item.isActive || priceVal !== item.defaultPrice;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await apiSend(`/api/admin/work-catalog/${item.id}`, "PATCH", {
        name,
        isActive,
        defaultPrice: priceVal,
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
      <td className="px-3 py-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-64" />
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="без цены"
          className="h-8 w-28"
        />
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

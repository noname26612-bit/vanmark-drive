"use client";

// Сводка v3 (решение Артёма 22.08.2026): читается сверху вниз — итоги за период, таблица-сравнение
// водителей, деньги. Подробности любой цифры раскрываются под её строкой.
//
// Период живёт в адресе (`?g&d`): начальное значение читает сервер из searchParams, дальше клиент
// правит адрес через history.replaceState — без useSearchParams (он требует Suspense-границы) и
// без RSC-запроса на каждый клик по стрелке.
//
// keepPreviousData: при смене периода старые числа остаются на экране, а рядом появляется
// «обновляем…». Раньше на их месте мигало «Загрузка…», и клик по стрелке выглядел как сбой.
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { normalizeAnchor, shiftAnchor, windowKeys, type Granularity } from "@/domain/summary";
import { summaryUrl } from "@/lib/summary-url";
import type { SummaryOverview } from "@/lib/summary-dto";
import { SummaryHeader } from "./_components/summary-header";
import { SummaryTotalsBlock } from "./_components/summary-totals";
import { DriversTable } from "./_components/drivers-table";
import { MoneyBlock } from "./_components/money-block";
import { CarrierSection } from "./_components/carrier-section";

export function SummaryClient({
  initialGranularity,
  initialDay,
  todayKey,
}: {
  initialGranularity: Granularity;
  /**
   * ВЫБРАННЫЙ день, а не якорь окна. Храним именно его: якорь недели/месяца — производная, и если
   * держать в состоянии только его, переключение «Неделя → День» на текущей неделе показывало бы
   * понедельник вместо сегодняшнего дня.
   */
  initialDay: string;
  todayKey: string; // сегодняшний московский день — для кнопки «Сегодня» и подписи «текущий период»
}) {
  const [granularity, setGranularity] = useState<Granularity>(initialGranularity);
  const [day, setDay] = useState(initialDay);
  const anchor = normalizeAnchor(granularity, day);

  const overviewUrl = (g: Granularity, a: string) =>
    `/api/summary/overview?granularity=${g}&date=${a}`;

  const { data, isLoading, isValidating } = useSWR<SummaryOverview>(
    overviewUrl(granularity, anchor),
    fetcher,
    { keepPreviousData: true },
  );
  // Предыдущий период того же разреза — только ради строчки «было N» под каждой плиткой итогов.
  // Отдельным запросом: сервер считает окно по одному якорю, и городить парный режим ради подписи
  // не за чем — ручка уже есть, ответ маленький.
  const { data: prev } = useSWR<SummaryOverview>(
    overviewUrl(granularity, shiftAnchor(granularity, anchor, -1)),
    fetcher,
    { keepPreviousData: true },
  );

  /** Единственная точка смены периода: состояние + адрес (чтобы F5 и «поделиться ссылкой» работали). */
  function applyPeriod(g: Granularity, d: string) {
    const normalized = normalizeAnchor(g, d);
    setGranularity(g);
    setDay(d);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", summaryUrl(g, normalized));
    }
  }

  // «Сегодня» прячем, когда текущий день и так внутри окна — кнопка, которая ничего не меняет, врёт.
  const w = windowKeys(granularity, anchor);
  const isToday = todayKey >= w.fromKey && todayKey <= w.toKey;

  return (
    <main className="mx-auto max-w-7xl p-4 lg:p-6">
      <SummaryHeader
        granularity={granularity}
        anchor={anchor}
        isToday={isToday}
        validating={isValidating && !!data}
        onGranularity={(g) => applyPeriod(g, day)}
        onShift={(delta) => applyPeriod(granularity, shiftAnchor(granularity, anchor, delta))}
        onToday={() => applyPeriod(granularity, todayKey)}
      />

      {isLoading && !data ? (
        <p className="mt-6 text-sm text-neutral-400">Загрузка…</p>
      ) : !data ? (
        <p className="mt-6 text-sm text-red-600">Не удалось загрузить сводку.</p>
      ) : (
        <>
          <SummaryTotalsBlock
            totals={data.totals}
            money={data.money}
            payrollVisible={data.payrollVisible}
            prevTotals={prev?.totals ?? null}
            prevMoney={prev?.money ?? null}
          />
          {data.drivers.length === 0 ? (
            <p className="mt-5 text-sm text-neutral-500">Нет активных водителей.</p>
          ) : (
            <DriversTable
              drivers={data.drivers}
              granularity={granularity}
              anchor={anchor}
              workdayMinutes={data.workdayMinutes}
            />
          )}
          <MoneyBlock
            money={data.money}
            payrollVisible={data.payrollVisible}
            granularity={granularity}
            anchor={anchor}
          />
          <CarrierSection granularity={granularity} anchor={anchor} />
        </>
      )}
    </main>
  );
}

import { describe, it, expect } from "vitest";
import {
  daysBetween,
  machineDueState,
  machineFlags,
  summarize,
  type FlaggableMachine,
} from "./machine-flags";
import type { MachineCategory } from "@/generated/prisma/enums";

// Опорные даты (МСК = UTC+3, полдень — чтобы день не «уезжал» через границу суток).
const at = (day: string, time = "12:00") => new Date(`${day}T${time}:00.000+03:00`);
const dateOnly = (day: string) => new Date(`${day}T00:00:00.000Z`); // как @db.Date

// По умолчанию станок «чистый»: обе обязательные отметки сделаны, индикаторы молчат. Каждый тест
// гасит ровно то, что проверяет, — так видно, от чего именно загорается лампочка.
const machine = (over: Partial<FlaggableMachine> = {}): FlaggableMachine => ({
  kind: "MACHINE",
  categories: ["CLIENT"],
  status: "NEEDS_REPAIR",
  isUrgent: false,
  dueDate: null,
  diagnosedAt: at("2026-08-03"),
  lastVerifiedAt: at("2026-08-03"),
  createdAt: at("2026-08-03"),
  ...over,
});

const BOTH: MachineCategory[] = ["OUR_SALE", "OUR_RENTAL"];

describe("machine-flags: календарные дни", () => {
  it("считает дни напрямую, обратный диапазон — ноль", () => {
    expect(daysBetween("2026-08-03", "2026-08-10")).toBe(7);
    expect(daysBetween("2026-08-10", "2026-08-03")).toBe(0);
    expect(daysBetween("", "2026-08-03")).toBe(0);
  });
});

// Диагностика и сверка переделаны 20.08.2026: это не «просрочка по календарю», а обязательная
// операция, которую делают один раз — при заведении карточки и при возврате из аренды. Поэтому
// признак предельно простой: отметки нет — горит, есть — не горит. Никаких порогов рабочих дней.
describe("machine-flags: диагностика и сверка — по факту отметки", () => {
  it("нет отметки диагностики — индикатор горит; появилась — гаснет", () => {
    expect(machineFlags(machine({ diagnosedAt: null }), at("2026-08-11")).awaitingDiagnosis).toBe(true);
    expect(machineFlags(machine({ diagnosedAt: at("2026-08-11") }), at("2026-08-11")).awaitingDiagnosis).toBe(
      false,
    );
  });

  it("нет отметки сверки — индикатор горит; появилась — гаснет", () => {
    expect(machineFlags(machine({ lastVerifiedAt: null }), at("2026-08-11")).notVerified).toBe(true);
    expect(machineFlags(machine({ lastVerifiedAt: at("2026-08-11") }), at("2026-08-11")).notVerified).toBe(
      false,
    );
  });

  it("возраст отметки не важен: диагностика полугодовой давности индикатор не зажигает", () => {
    // Отметки сбрасывает сервер при возврате из аренды — сравнивать даты здесь нечему и незачем.
    const old = machine({ diagnosedAt: at("2026-01-10"), lastVerifiedAt: at("2026-01-10") });
    const flags = machineFlags(old, at("2026-08-11"));
    expect(flags.awaitingDiagnosis).toBe(false);
    expect(flags.notVerified).toBe(false);
  });

  it("день недели ничего не решает — в выходные индикатор ведёт себя так же", () => {
    const m = machine({ diagnosedAt: null, lastVerifiedAt: null });
    const saturday = machineFlags(m, at("2026-08-08"));
    const monday = machineFlags(m, at("2026-08-10"));
    expect(saturday).toEqual(monday);
  });

  it("в аренде обе отметки гаснут — станок у клиента, осматривать и сверять некому", () => {
    const rented = machine({ status: "RENTED", diagnosedAt: null, lastVerifiedAt: null });
    const flags = machineFlags(rented, at("2026-08-11"));
    expect(flags.awaitingDiagnosis).toBe(false);
    expect(flags.notVerified).toBe(false);
  });

  it("«срочно» в аренде НЕ гаснет — это пометка про саму работу, а не про площадку", () => {
    const rented = machine({ status: "RENTED", isUrgent: true, diagnosedAt: null });
    expect(machineFlags(rented, at("2026-08-11")).urgent).toBe(true);
  });

  it("складская позиция не подсвечивается ничем — это остатки, а не станок", () => {
    const stock = machine({
      kind: "UNCOILER",
      quantity: 4,
      isUrgent: true,
      diagnosedAt: null,
      lastVerifiedAt: null,
      dueDate: dateOnly("2026-08-01"),
    });
    expect(machineFlags(stock, at("2026-08-11"))).toEqual({
      urgent: false,
      awaitingDiagnosis: false,
      notVerified: false,
      duePressing: false,
    });
  });

  it("архивный станок не подсвечивается ничем — его на площадке нет", () => {
    const gone = machine({
      status: "RELEASED",
      isUrgent: true,
      diagnosedAt: null,
      lastVerifiedAt: null,
      dueDate: dateOnly("2026-08-01"), // даже просроченный срок в архиве не горит
    });
    expect(machineFlags(gone, at("2026-08-11"))).toEqual({
      urgent: false,
      awaitingDiagnosis: false,
      notVerified: false,
      duePressing: false,
    });
  });
});

describe("machine-flags: срок готовности/выдачи", () => {
  // «Сегодня» в тестах — 2026-08-11 (вторник), полдень МСК.
  const now = at("2026-08-11");
  const dueOn = (day: string) => machine({ dueDate: dateOnly(day) });

  it("просрочен: срок вчера и раньше", () => {
    expect(machineDueState(dueOn("2026-08-10"), now)).toBe("overdue");
    expect(machineDueState(dueOn("2026-07-01"), now)).toBe("overdue");
  });

  it("горит: срок сегодня и в ближайшие 2 дня; дальше — спокойно", () => {
    expect(machineDueState(dueOn("2026-08-11"), now)).toBe("soon"); // сегодня — ещё не просрочен
    expect(machineDueState(dueOn("2026-08-12"), now)).toBe("soon");
    expect(machineDueState(dueOn("2026-08-13"), now)).toBe("soon"); // ровно +2
    expect(machineDueState(dueOn("2026-08-14"), now)).toBe(null); // +3 — рано подсвечивать
  });

  it("без срока не горит", () => {
    expect(machineDueState(machine(), now)).toBe(null);
  });

  it("в аренде и в архиве срок не горит даже просроченный", () => {
    expect(
      machineDueState(machine({ status: "RENTED", dueDate: dateOnly("2026-08-01") }), now),
    ).toBe(null);
    expect(
      machineDueState(machine({ status: "RELEASED", dueDate: dateOnly("2026-08-01") }), now),
    ).toBe(null);
    expect(
      machineDueState(machine({ status: "VOIDED", dueDate: dateOnly("2026-08-01") }), now),
    ).toBe(null);
  });

  it("у выведенного из оборота «Принят» срок не горит — его нет среди активных состояний", () => {
    expect(machineDueState({ status: "ACCEPTED", dueDate: "2026-08-01" }, now)).toBe(null);
  });

  it("принимает дату и строкой YYYY-MM-DD (клиентский DTO) — порог один на всех", () => {
    expect(machineDueState({ status: "IN_REPAIR", dueDate: "2026-08-12" }, now)).toBe("soon");
    expect(machineDueState({ status: "IN_REPAIR", dueDate: "2026-08-10" }, now)).toBe("overdue");
    expect(machineDueState({ status: "IN_REPAIR", dueDate: "мусор" }, now)).toBe(null);
  });

  it("граница МСК-суток: в 23:30 UTC по Москве уже следующий день", () => {
    // 2026-08-11T23:30Z = 2026-08-12 02:30 МСК → срок «завтра, 12-е» уже сегодняшний.
    const lateUtc = new Date("2026-08-11T23:30:00.000Z");
    expect(machineDueState(dueOn("2026-08-12"), lateUtc)).toBe("soon");
    expect(machineDueState(dueOn("2026-08-11"), lateUtc)).toBe("overdue"); // 11-е по МСК уже вчера
  });

  it("duePressing в флагах: горит и просроченный, спокойный — нет", () => {
    expect(machineFlags(dueOn("2026-08-10"), now).duePressing).toBe(true);
    expect(machineFlags(dueOn("2026-08-12"), now).duePressing).toBe(true);
    expect(machineFlags(dueOn("2026-08-20"), now).duePressing).toBe(false);
  });
});

describe("machine-flags: счётчики сводки", () => {
  const now = at("2026-08-11");

  it("считает парк по категориям и состояниям, архив отдельно", () => {
    const s = summarize(
      [
        machine({ categories: ["CLIENT"], status: "NEEDS_REPAIR" }),
        machine({ categories: ["CLIENT"], status: "IN_REPAIR" }),
        machine({ categories: ["OUR_SALE"], status: "READY" }),
        machine({ categories: ["OUR_RENTAL"], status: "RENTED" }),
        machine({ categories: ["CLIENT"], status: "RELEASED" }), // архив
        machine({ categories: ["OUR_SALE"], status: "SOLD" }), // архив
      ],
      now,
    );
    expect(s.total).toBe(4);
    expect(s.archived).toBe(2);
    expect(s.byCategory).toEqual({ CLIENT: 2, OUR_SALE: 1, OUR_RENTAL: 1 });
    expect(s.byStatus.NEEDS_REPAIR).toBe(1);
    expect(s.byStatus.RENTED).toBe(1);
    expect(s.byStatus.RELEASED).toBe(1);
  });

  it("станок двойного назначения считается в ОБЕИХ категориях — сумма больше парка", () => {
    // Это не ошибка счёта: плитка «Наш арендный» должна показывать всё, что можно сдать, а плитка
    // «Наш на продажу» — всё, что можно продать. Один станок правда стоит и там, и там.
    const s = summarize([machine({ categories: BOTH, status: "READY" })], now);
    expect(s.total).toBe(1);
    expect(s.byCategory).toEqual({ CLIENT: 0, OUR_SALE: 1, OUR_RENTAL: 1 });
    const sumByCategory = s.byCategory.CLIENT + s.byCategory.OUR_SALE + s.byCategory.OUR_RENTAL;
    expect(sumByCategory).toBeGreaterThan(s.total);
  });

  it("порядок категорий в карточке на счёт не влияет", () => {
    const straight = summarize([machine({ categories: ["OUR_SALE", "OUR_RENTAL"] })], now);
    const reversed = summarize([machine({ categories: ["OUR_RENTAL", "OUR_SALE"] })], now);
    expect(straight.byCategory).toEqual(reversed.byCategory);
  });

  it("аннулированные не входят в парк и не попадают в архивный счётчик", () => {
    const s = summarize(
      [machine({ status: "READY" }), machine({ status: "VOIDED" }), machine({ status: "VOIDED" })],
      now,
    );
    expect(s.total).toBe(1);
    expect(s.voided).toBe(2);
    expect(s.archived).toBe(0);
    expect(s.byCategory.CLIENT).toBe(1);
  });

  it("индикаторы суммируются только по активным", () => {
    const s = summarize(
      [
        machine({ isUrgent: true, diagnosedAt: null, lastVerifiedAt: null }),
        machine({ status: "RELEASED", diagnosedAt: null, lastVerifiedAt: null }), // архив — не считается
        machine({ status: "RENTED", diagnosedAt: null, lastVerifiedAt: null }), // в аренде — не считается
        machine({ diagnosedAt: null }), // только диагностика
      ],
      now,
    );
    expect(s.urgent).toBe(1);
    expect(s.awaitingDiagnosis).toBe(2);
    expect(s.notVerified).toBe(1);
  });

  it("пустой парк — нули без падений", () => {
    const s = summarize([], now);
    expect(s.total).toBe(0);
    expect(s.byStatus.NEEDS_REPAIR).toBe(0);
    expect(s.byCategory.CLIENT).toBe(0);
    expect(s.byKind).toEqual({
      MACHINE: 0,
      ROLLER_KNIFE: 0,
      FALZ_MACHINE: 0,
      SEAMER: 0,
      UNCOILER: 0,
      INVERTER: 0,
    });
    expect(s.duePressing).toBe(0);
  });

  it("считает виды по активным: архивный нож в счётчик не входит, фальц машинка входит", () => {
    const s = summarize(
      [
        machine(),
        machine({ kind: "ROLLER_KNIFE" }),
        machine({ kind: "FALZ_MACHINE" }),
        machine({ kind: "ROLLER_KNIFE", status: "RELEASED" }), // архив
      ],
      now,
    );
    expect(s.byKind).toEqual({
      MACHINE: 1,
      ROLLER_KNIFE: 1,
      FALZ_MACHINE: 1,
      SEAMER: 0,
      UNCOILER: 0,
      INVERTER: 0,
    });
  });

  it("складские позиции считаются ШТУКАМИ и в парк не входят", () => {
    // Карточка складского вида — это модель с остатком, а не экземпляр: у неё нет ни состояния,
    // ни категории, поэтому плитки парка её не видят, а «Размотчики» показывают штуки.
    const s = summarize(
      [
        machine({ kind: "UNCOILER", quantity: 5, status: "READY" }),
        machine({ kind: "INVERTER", quantity: 2, status: "READY" }),
        machine({ kind: "INVERTER" }), // без quantity — считается за одну штуку
        machine({ kind: "MACHINE", status: "READY" }),
      ],
      now,
    );
    expect(s.byKind.UNCOILER).toBe(5);
    expect(s.byKind.INVERTER).toBe(3);
    expect(s.total).toBe(1);
    expect(s.byStatus.READY).toBe(1); // складские в состояния не попали
    expect(s.byCategory.CLIENT).toBe(1);
  });

  it("горящие сроки суммируются только по активным станкам", () => {
    const s = summarize(
      [
        machine({ dueDate: dateOnly("2026-08-10") }), // просрочен
        machine({ dueDate: dateOnly("2026-08-12") }), // горит
        machine({ dueDate: dateOnly("2026-08-25") }), // спокойный
        machine({ dueDate: dateOnly("2026-08-10"), status: "RENTED" }), // аренда — не считается
        machine({ dueDate: dateOnly("2026-08-10"), status: "RELEASED" }), // архив — не считается
      ],
      now,
    );
    expect(s.duePressing).toBe(2);
  });

  it("старые карточки со снятым «Принят» из парка не выпадают", () => {
    // Состояние выведено из оборота, но в истории и в старых записях оно есть — счётчики должны
    // считать такой станок обычным активным, иначе парк «похудеет» на ровном месте.
    const s = summarize([machine({ status: "ACCEPTED" })], now);
    expect(s.total).toBe(1);
    expect(s.byStatus.ACCEPTED).toBe(1);
    expect(s.archived).toBe(0);
  });
});

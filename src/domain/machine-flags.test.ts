import { describe, it, expect } from "vitest";
import {
  daysBetween,
  isWeekend,
  machineDueState,
  machineFlags,
  summarize,
  workdaysBetween,
  type FlaggableMachine,
} from "./machine-flags";
import type { MachineCategory, MachineStatus } from "@/generated/prisma/enums";

// Опорные даты (МСК = UTC+3, полдень — чтобы день не «уезжал» через границу суток).
// 2026-08-03 — понедельник, 2026-08-08 — суббота, 2026-08-09 — воскресенье.
const at = (day: string, time = "12:00") => new Date(`${day}T${time}:00.000+03:00`);
const dateOnly = (day: string) => new Date(`${day}T00:00:00.000Z`); // как @db.Date

const machine = (over: Partial<FlaggableMachine> = {}): FlaggableMachine => ({
  kind: "MACHINE",
  category: "CLIENT" as MachineCategory,
  status: "ACCEPTED" as MachineStatus,
  invoice1C: "4512",
  isUrgent: false,
  arrivedAt: dateOnly("2026-08-03"),
  dueDate: null,
  diagnosedAt: null,
  lastVerifiedAt: at("2026-08-03"),
  createdAt: at("2026-08-03"),
  ...over,
});

describe("machine-flags: рабочие дни", () => {
  it("суббота и воскресенье — выходные", () => {
    expect(isWeekend("2026-08-08")).toBe(true);
    expect(isWeekend("2026-08-09")).toBe(true);
    expect(isWeekend("2026-08-07")).toBe(false); // пятница
  });

  it("считает рабочие дни строго после начальной даты", () => {
    expect(workdaysBetween("2026-08-03", "2026-08-03")).toBe(0); // тот же день
    expect(workdaysBetween("2026-08-03", "2026-08-04")).toBe(1); // пн → вт
    expect(workdaysBetween("2026-08-03", "2026-08-05")).toBe(2); // пн → ср
  });

  it("выходные не считаются: пятница → понедельник это один рабочий день", () => {
    expect(workdaysBetween("2026-08-07", "2026-08-10")).toBe(1);
    expect(workdaysBetween("2026-08-07", "2026-08-11")).toBe(2);
  });

  it("обратный и некорректный диапазон — ноль", () => {
    expect(workdaysBetween("2026-08-10", "2026-08-03")).toBe(0);
    expect(workdaysBetween("", "2026-08-03")).toBe(0);
  });

  it("календарные дни считаются напрямую", () => {
    expect(daysBetween("2026-08-03", "2026-08-10")).toBe(7);
    expect(daysBetween("2026-08-10", "2026-08-03")).toBe(0);
  });
});

describe("machine-flags: индикаторы станка", () => {
  it("клиентский без заказа 1С подсвечивается, с заказом — нет", () => {
    expect(machineFlags(machine({ invoice1C: null }), at("2026-08-03")).noInvoice1C).toBe(true);
    expect(machineFlags(machine({ invoice1C: "  " }), at("2026-08-03")).noInvoice1C).toBe(true);
    expect(machineFlags(machine({ invoice1C: "4512" }), at("2026-08-03")).noInvoice1C).toBe(false);
  });

  it("наш станок без заказа 1С не подсвечивается — заказ бывает только у клиентских", () => {
    const our = machine({ category: "OUR_SALE", invoice1C: null });
    expect(machineFlags(our, at("2026-08-03")).noInvoice1C).toBe(false);
  });

  it("ждёт диагностики только когда прошло БОЛЬШЕ рабочего дня", () => {
    const m = machine({ status: "ACCEPTED", diagnosedAt: null });
    expect(machineFlags(m, at("2026-08-03")).awaitingDiagnosis).toBe(false); // день приёмки
    expect(machineFlags(m, at("2026-08-04")).awaitingDiagnosis).toBe(false); // норматив — 1 раб. день
    expect(machineFlags(m, at("2026-08-05")).awaitingDiagnosis).toBe(true); // просрочка
  });

  it("выходные не превращают приёмку в пятницу в просрочку понедельника", () => {
    const m = machine({ arrivedAt: dateOnly("2026-08-07") }); // пятница
    expect(machineFlags(m, at("2026-08-10")).awaitingDiagnosis).toBe(false); // понедельник
    expect(machineFlags(m, at("2026-08-11")).awaitingDiagnosis).toBe(true); // вторник
  });

  it("проведённая диагностика снимает индикатор", () => {
    const m = machine({ diagnosedAt: at("2026-08-04") });
    expect(machineFlags(m, at("2026-08-10")).awaitingDiagnosis).toBe(false);
  });

  it("повторный заезд снова требует диагностики — старая отметка не засчитывается", () => {
    // Клиент привозит тот же станок второй раз: карточка живёт та же (PRD §16.3), но диагностика
    // с прошлого заезда к новому отношения не имеет — иначе индикатор не загорится уже никогда.
    const secondVisit = machine({
      status: "ACCEPTED",
      diagnosedAt: at("2026-07-10"), // диагностика прошлого заезда
      arrivedAt: dateOnly("2026-08-03"), // новое поступление
    });
    expect(machineFlags(secondVisit, at("2026-08-05")).awaitingDiagnosis).toBe(true);
  });

  it("диагностика в день поступления засчитывается", () => {
    const m = machine({ arrivedAt: dateOnly("2026-08-03"), diagnosedAt: at("2026-08-03") });
    expect(machineFlags(m, at("2026-08-10")).awaitingDiagnosis).toBe(false);
  });

  it("индикатор диагностики только у принятых (в ремонте — уже не ждёт)", () => {
    const m = machine({ status: "IN_REPAIR", diagnosedAt: null });
    expect(machineFlags(m, at("2026-08-10")).awaitingDiagnosis).toBe(false);
  });

  it("«давно не сверялся» загорается после недели", () => {
    const m = machine({ lastVerifiedAt: at("2026-08-03") });
    expect(machineFlags(m, at("2026-08-10")).staleVerification).toBe(false); // ровно 7 дней
    expect(machineFlags(m, at("2026-08-11")).staleVerification).toBe(true);
  });

  it("ни разу не сверялся — отсчёт от дня заведения карточки", () => {
    const m = machine({ lastVerifiedAt: null, createdAt: at("2026-08-03") });
    expect(machineFlags(m, at("2026-08-05")).staleVerification).toBe(false); // свежая карточка
    expect(machineFlags(m, at("2026-08-12")).staleVerification).toBe(true);
  });

  it("архивный станок не подсвечивается ничем — его на площадке нет", () => {
    const gone = machine({
      status: "RELEASED",
      invoice1C: null,
      isUrgent: true,
      lastVerifiedAt: at("2026-01-01"),
      dueDate: dateOnly("2026-08-01"), // даже просроченный срок в архиве не горит
    });
    expect(machineFlags(gone, at("2026-08-11"))).toEqual({
      noInvoice1C: false,
      urgent: false,
      awaitingDiagnosis: false,
      staleVerification: false,
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

  it("принимает дату и строкой YYYY-MM-DD (клиентский DTO) — порог один на всех", () => {
    expect(machineDueState({ status: "ACCEPTED", dueDate: "2026-08-12" }, now)).toBe("soon");
    expect(machineDueState({ status: "ACCEPTED", dueDate: "2026-08-10" }, now)).toBe("overdue");
    expect(machineDueState({ status: "ACCEPTED", dueDate: "мусор" }, now)).toBe(null);
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
        machine({ category: "CLIENT", status: "ACCEPTED" }),
        machine({ category: "CLIENT", status: "IN_REPAIR" }),
        machine({ category: "OUR_SALE", status: "READY" }),
        machine({ category: "OUR_RENTAL", status: "RENTED" }),
        machine({ category: "CLIENT", status: "RELEASED" }), // архив
        machine({ category: "OUR_SALE", status: "SOLD" }), // архив
      ],
      now,
    );
    expect(s.total).toBe(4);
    expect(s.archived).toBe(2);
    expect(s.byCategory).toEqual({ CLIENT: 2, OUR_SALE: 1, OUR_RENTAL: 1 });
    expect(s.byStatus.ACCEPTED).toBe(1);
    expect(s.byStatus.RENTED).toBe(1);
    expect(s.byStatus.RELEASED).toBe(1);
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
        machine({ invoice1C: null, isUrgent: true }), // без заказа + срочный
        machine({ invoice1C: null, status: "RELEASED" }), // архив — не считается
        machine({ status: "ACCEPTED", arrivedAt: dateOnly("2026-08-03") }), // ждёт диагностики
      ],
      now,
    );
    expect(s.noInvoice1C).toBe(1);
    expect(s.urgent).toBe(1);
    expect(s.awaitingDiagnosis).toBe(2);
  });

  it("пустой парк — нули без падений", () => {
    const s = summarize([], now);
    expect(s.total).toBe(0);
    expect(s.byStatus.ACCEPTED).toBe(0);
    expect(s.byCategory.CLIENT).toBe(0);
    expect(s.byKind).toEqual({ MACHINE: 0, ROLLER_KNIFE: 0, SEAMER: 0, UNCOILER: 0, INVERTER: 0 });
    expect(s.duePressing).toBe(0);
  });

  it("считает виды по активным: архивный нож в счётчик не входит", () => {
    const s = summarize(
      [
        machine(),
        machine({ kind: "ROLLER_KNIFE" }),
        machine({ kind: "ROLLER_KNIFE", status: "RELEASED" }), // архив
      ],
      now,
    );
    expect(s.byKind).toEqual({ MACHINE: 1, ROLLER_KNIFE: 1, SEAMER: 0, UNCOILER: 0, INVERTER: 0 });
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
});

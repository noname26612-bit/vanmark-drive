import { describe, it, expect } from "vitest";
import { myTasksWhere } from "./my-tasks";

const ME = "driver-a-id";
const OTHER = "driver-b-id";
const TODAY = new Date("2026-06-04T00:00:00.000Z");

// Владение (20.07.2026): «мои» = ответственный ИЛИ напарник, всегда в верхнеуровневом AND.
const OWNERSHIP = { OR: [{ assigneeId: ME }, { coDriverId: ME }] };

describe("myTasksWhere — изоляция водителя (ARCHITECTURE §6)", () => {
  it("владение прибито к своему id в верхнеуровневом AND (оба scope)", () => {
    for (const scope of ["today", "upcoming"] as const) {
      const w = myTasksWhere(ME, TODAY, scope);
      // Первый элемент AND — блок владения: OR только из своих assigneeId/coDriverId.
      const and = w.AND as Array<Record<string, unknown>>;
      expect(and[0]).toEqual(OWNERSHIP);
    }
  });

  it("в where нет ни одного пути без привязки владения к моему id", () => {
    for (const scope of ["today", "upcoming"] as const) {
      const w = myTasksWhere(ME, TODAY, scope);
      const json = JSON.stringify(w);
      // Ни одно упоминание assigneeId/coDriverId не указывает на чужой id, и оба поля — только мои.
      expect(json).not.toContain(OTHER);
      expect(json).toContain(`"assigneeId":"${ME}"`);
      expect(json).toContain(`"coDriverId":"${ME}"`);
      // Владение — в AND верхнего уровня, а не в OR с ветками дат (иначе даты «вытащили бы» чужие).
      expect(Array.isArray(w.AND)).toBe(true);
      expect(w.OR).toBeUndefined();
    }
  });
});

describe("myTasksWhere — контуры вместе (15.08.2026)", () => {
  it("телефон показывает и доставки, и задачи сотрудникам: по контуру НЕ фильтруем", () => {
    // У Александра с Николаем в один день бывают и заявки, и работа в цехе — экран «Сегодня» обязан
    // показывать всё сразу. Ассерт защитный: услужливый фильтр kind здесь спрячет половину работы.
    for (const scope of ["today", "upcoming"] as const) {
      expect(JSON.stringify(myTasksWhere(ME, TODAY, scope))).not.toContain("kind");
    }
  });
});

describe("myTasksWhere — наполнение вкладок", () => {
  it("today: сегодняшние + просроченные открытые + без даты открытые", () => {
    const w = myTasksWhere(ME, TODAY, "today");
    const and = w.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({
      OR: [
        { scheduledDate: TODAY },
        { scheduledDate: { lt: TODAY }, status: { notIn: ["DONE", "CANCELLED"] } },
        { scheduledDate: null, status: { notIn: ["DONE", "CANCELLED"] } },
      ],
    });
  });

  it("upcoming: только будущее (дата > сегодня), без отменённых", () => {
    const w = myTasksWhere(ME, TODAY, "upcoming");
    const and = w.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ scheduledDate: { gt: TODAY }, status: { not: "CANCELLED" } });
  });

  // 11.08.2026: отменённую заявку водителю не показываем нигде — про отмену ему приходит пуш,
  // а в списке она только сбивает («ехать или не ехать?»).
  it("today: отменённые исключены целиком, а не только в ветке просрочки", () => {
    const and = myTasksWhere(ME, TODAY, "today").AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ status: { not: "CANCELLED" } });
  });

  // 11.08.2026: архив — мягкое удаление, заявка убрана из работы полностью.
  it("архивные не попадают ни в одну вкладку", () => {
    for (const scope of ["today", "upcoming"] as const) {
      const and = myTasksWhere(ME, TODAY, scope).AND as Array<Record<string, unknown>>;
      expect(and).toContainEqual({ archivedAt: null });
    }
  });
});

// Unit на runQueueOnce — ядро досылки очереди (O8). Зависимости инжектируются (как в fetchWithCache),
// поэтому тестируем логику прогона без IndexedDB/сети: порядок, стоп на сети/401, конфликт на 4xx.
import { describe, it, expect, vi } from "vitest";
import { runQueueOnce, type QueueDeps } from "./sync";
import { ApiError } from "@/lib/fetcher";
import type { QueuedAction } from "./types";

function action(over: Partial<QueuedAction>): QueuedAction {
  return {
    id: "a1",
    seq: 1,
    kind: "transition",
    method: "POST",
    url: "/api/tasks/t/transition",
    occurredAt: "2026-07-02T10:00:00.000Z",
    taskId: "t",
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-02T10:00:00.000Z",
    ...over,
  };
}

// Собирает deps с заданным списком и поведением send; фиксирует вызовы remove/markConflict/bumpAttempts/auth.
function deps(list: QueuedAction[], send: QueueDeps["send"]): QueueDeps & {
  removed: string[];
  conflicts: { id: string; code: string }[];
  conflictAttempts: { id: string; attempts: number }[];
  bumped: { id: string; attempts: number }[];
  auth: string[];
} {
  const removed: string[] = [];
  const conflicts: { id: string; code: string }[] = [];
  const conflictAttempts: { id: string; attempts: number }[] = [];
  const bumped: { id: string; attempts: number }[] = [];
  const auth: string[] = [];
  return {
    list: () => Promise.resolve(list),
    send,
    remove: (id) => {
      removed.push(id);
      return Promise.resolve();
    },
    dropBlob: () => Promise.resolve(),
    markConflict: (a, e, attempts) => {
      conflicts.push({ id: a.id, code: e.code });
      conflictAttempts.push({ id: a.id, attempts });
      return Promise.resolve();
    },
    bumpAttempts: (a, attempts) => {
      bumped.push({ id: a.id, attempts });
      return Promise.resolve();
    },
    onAuthRequired: () => auth.push("required"),
    onAuthOk: () => auth.push("ok"),
    removed,
    conflicts,
    conflictAttempts,
    bumped,
    auth,
  };
}

// Stateful-deps: список живёт в Map и переживает несколько прогонов (bumpAttempts/markConflict/remove
// реально его меняют) — чтобы проверить накопление порога тик-за-тиком, как в бою (IndexedDB между тиками).
function statefulDeps(initial: QueuedAction[], send: QueueDeps["send"]) {
  const store = new Map<string, QueuedAction>(initial.map((a) => [a.id, { ...a }]));
  const removed: string[] = [];
  const d: QueueDeps = {
    list: () => Promise.resolve([...store.values()].sort((a, b) => a.seq - b.seq)),
    send: (a) => send(store.get(a.id) ?? a),
    remove: (id) => {
      removed.push(id);
      store.delete(id);
      return Promise.resolve();
    },
    dropBlob: () => Promise.resolve(),
    markConflict: (a, lastError, attempts) => {
      // Зеркалит боевой DEPS.markConflict: сохраняет ПЕРЕДАННЫЙ счётчик (не пересчитывает), чтобы тест
      // отражал реальную семантику, а не скрытый инкремент.
      store.set(a.id, { ...a, status: "conflict", attempts, lastError });
      return Promise.resolve();
    },
    bumpAttempts: (a, attempts) => {
      store.set(a.id, { ...a, attempts });
      return Promise.resolve();
    },
    onAuthRequired: () => {},
    onAuthOk: () => {},
  };
  return { deps: d, store, removed };
}

describe("runQueueOnce (O8)", () => {
  it("все действия успешны → каждое удалено, sent = N, сессия помечена живой", async () => {
    const d = deps([action({ id: "a1", seq: 1 }), action({ id: "a2", seq: 2 })], () => Promise.resolve());
    const sent = await runQueueOnce(d);
    expect(sent).toBe(2);
    expect(d.removed).toEqual(["a1", "a2"]);
    expect(d.conflicts).toEqual([]);
    expect(d.auth).toContain("ok");
  });

  it("retryable-ошибка (нет сети) → стоп: действие НЕ конфликт, остаётся в очереди", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError("нет сети", 0, "NETWORK"));
    const d = deps([action({ id: "a1", seq: 1 }), action({ id: "a2", seq: 2 })], send);
    const sent = await runQueueOnce(d);
    expect(sent).toBe(1);
    expect(d.removed).toEqual(["a1"]); // a2 не тронут — досошлётся позже
    expect(d.conflicts).toEqual([]);
  });

  it("инфраструктурный 5xx (503 — прокси при деплое) → стоп без конфликта, счётчик НЕ растёт", async () => {
    const d = deps([action({ id: "a1", attempts: 4 })], () => Promise.reject(new ApiError("503", 503, "UNAVAILABLE")));
    const sent = await runQueueOnce(d);
    expect(sent).toBe(0);
    expect(d.conflicts).toEqual([]); // 502/503/504 к порогу не считаем — деплой не уводит очередь в конфликт
    expect(d.bumped).toEqual([]); // attempts не трогаем, хотя он уже 4 (у порога)
    expect(d.removed).toEqual([]);
  });

  it("401 → флаг authRequired, стоп, действие НЕ конфликт (сессия истекла)", async () => {
    const d = deps([action({ id: "a1" }), action({ id: "a2", seq: 2 })], () =>
      Promise.reject(new ApiError("нет сессии", 401, "UNAUTHORIZED")),
    );
    const sent = await runQueueOnce(d);
    expect(sent).toBe(0);
    expect(d.auth).toEqual(["required"]);
    expect(d.conflicts).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("403 → как 401 (права/сессия), НЕ конфликт", async () => {
    const d = deps([action({ id: "a1" })], () => Promise.reject(new ApiError("нет прав", 403, "FORBIDDEN")));
    await runQueueOnce(d);
    expect(d.auth).toEqual(["required"]);
    expect(d.conflicts).toEqual([]);
  });

  it("доменная 4xx (409) → конфликт, прогон продолжается со следующим действием", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("нельзя", 409, "FORBIDDEN_TRANSITION"))
      .mockResolvedValueOnce(undefined);
    const d = deps([action({ id: "a1", seq: 1 }), action({ id: "a2", seq: 2 })], send);
    const sent = await runQueueOnce(d);
    expect(d.conflicts).toEqual([{ id: "a1", code: "FORBIDDEN_TRANSITION" }]);
    expect(d.removed).toEqual(["a2"]); // a2 всё равно доставлено
    expect(sent).toBe(1);
  });

  it("потерянный blob (422 BLOB_MISSING) → конфликт с человеческим кодом, не тихий успех", async () => {
    const d = deps([action({ id: "a1", blobId: "b1", kind: "attachment" })], () =>
      Promise.reject(new ApiError("Фото не сохранилось на телефоне — снимите заново", 422, "BLOB_MISSING")),
    );
    await runQueueOnce(d);
    expect(d.conflicts).toEqual([{ id: "a1", code: "BLOB_MISSING" }]);
    expect(d.removed).toEqual([]);
  });

  it("уже конфликтные действия пропускаются (не досылаются повторно)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const d = deps([action({ id: "a1", status: "conflict" }), action({ id: "a2", seq: 2 })], send);
    const sent = await runQueueOnce(d);
    expect(send).toHaveBeenCalledTimes(1); // только a2
    expect(d.removed).toEqual(["a2"]);
    expect(sent).toBe(1);
  });
});

// Предохранитель (инцидент 06.07): детерминированная 500 на одном действии не должна блокировать
// очередь навсегда. Считаем к порогу только реальные ответы приложения 5xx, не обрывы связи.
describe("runQueueOnce — предохранитель от «ядовитого» действия", () => {
  it("серверный отказ (500) ниже порога → attempts растёт, прогон стоп (не конфликт, FIFO цел)", async () => {
    const send = vi.fn().mockRejectedValue(new ApiError("бум", 500, "INTERNAL"));
    const d = deps([action({ id: "a1", seq: 1 }), action({ id: "a2", seq: 2 })], send);
    const sent = await runQueueOnce(d);
    expect(sent).toBe(0);
    expect(d.bumped).toEqual([{ id: "a1", attempts: 1 }]); // счётчик сохранён между тиками
    expect(d.conflicts).toEqual([]); // ещё не порог — не конфликт
    expect(d.removed).toEqual([]); // a2 не тронут — стоп сохраняет порядок
    expect(send).toHaveBeenCalledTimes(1); // до a2 не дошли
  });

  it("N-й (5-й) подряд отказ 500 → действие в conflict (SERVER_REJECTED), очередь идёт дальше", async () => {
    // a1 уже провалился 4 раза (attempts=4); 5-й отказ достигает порога SERVER_ERROR_LIMIT=5.
    const send = vi
      .fn()
      .mockImplementation((a: QueuedAction) =>
        a.id === "a1" ? Promise.reject(new ApiError("бум", 500, "INTERNAL")) : Promise.resolve(),
      );
    const d = deps([action({ id: "a1", seq: 1, attempts: 4 }), action({ id: "a2", seq: 2 })], send);
    const sent = await runQueueOnce(d);
    expect(d.conflicts).toEqual([{ id: "a1", code: "SERVER_REJECTED" }]); // застрявшее изолировано
    expect(d.conflictAttempts).toEqual([{ id: "a1", attempts: 5 }]); // ровно порог, без двойного инкремента
    expect(d.bumped).toEqual([]); // на пороге не bump, а сразу markConflict
    expect(d.removed).toEqual(["a2"]); // прогон ПРОДОЛЖЕН — a2 доставлен
    expect(sent).toBe(1);
  });

  it("прочий 5xx (501 — инфраструктура/деплой) НЕ считается к порогу, даже у самого порога", async () => {
    // К порогу считаем ТОЛЬКО app-500; редкие 501/505/510 и прокси-502/503/504 — временный сбой.
    const d = deps([action({ id: "a1", attempts: 4 }), action({ id: "a2", seq: 2 })], () =>
      Promise.reject(new ApiError("не реализовано", 501, "NOT_IMPLEMENTED")),
    );
    const sent = await runQueueOnce(d);
    expect(sent).toBe(0);
    expect(d.conflicts).toEqual([]); // не 500 → не отказ приложения, к порогу не считаем
    expect(d.bumped).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("долгий офлайн (status 0) НЕ уводит в conflict, даже если attempts у порога", async () => {
    // Ключевая защита от ложного срабатывания: нет сети — не вина действия, счётчик не трогаем.
    const d = deps([action({ id: "a1", attempts: 4 }), action({ id: "a2", seq: 2 })], () =>
      Promise.reject(new ApiError("нет сети", 0, "NETWORK")),
    );
    const sent = await runQueueOnce(d);
    expect(sent).toBe(0);
    expect(d.conflicts).toEqual([]); // status 0 к порогу не считаем
    expect(d.bumped).toEqual([]); // attempts не растёт от обрыва связи
    expect(d.removed).toEqual([]);
  });

  it("накопление тик-за-тиком: 5 прогонов по 500 → conflict, затем остальные досылаются", async () => {
    const send = vi.fn((a: QueuedAction) =>
      a.id === "poison" ? Promise.reject(new ApiError("бум", 500, "INTERNAL")) : Promise.resolve(),
    );
    const { deps: d, store, removed } = statefulDeps(
      [action({ id: "poison", seq: 1 }), action({ id: "ok", seq: 2 })],
      send,
    );
    // Первые 4 тика: poison отбивается 500, наращивает attempts и держит очередь (ok за ним не идёт).
    for (let i = 0; i < 4; i++) await runQueueOnce(d);
    expect(store.get("poison")?.status).toBe("pending");
    expect(store.get("poison")?.attempts).toBe(4);
    expect(removed).toEqual([]); // ok ещё не доставлен — FIFO держит его за poison
    // 5-й тик: порог достигнут → poison в conflict, прогон продолжается → ok уходит.
    await runQueueOnce(d);
    expect(store.get("poison")?.status).toBe("conflict");
    expect(store.get("poison")?.lastError?.code).toBe("SERVER_REJECTED");
    expect(store.get("poison")?.attempts).toBe(5);
    expect(removed).toEqual(["ok"]); // очередь разблокирована
    expect(store.get("ok")).toBeUndefined();
  });

  it("500 сменяется успехом до порога → действие уходит нормально, счётчик не вредит", async () => {
    // Транзиентная 500 (например, кратковременный сбой БД) не должна превращать действие в конфликт,
    // если следующий тик прошёл: действие просто досылается и удаляется.
    let calls = 0;
    const send = vi.fn((a: QueuedAction) => {
      if (a.id !== "a1") return Promise.resolve();
      calls++;
      return calls <= 2 ? Promise.reject(new ApiError("бум", 500, "INTERNAL")) : Promise.resolve();
    });
    const { deps: d, store, removed } = statefulDeps(
      [action({ id: "a1", seq: 1 }), action({ id: "a2", seq: 2 })],
      send,
    );
    await runQueueOnce(d); // 500 → attempts=1, стоп
    await runQueueOnce(d); // 500 → attempts=2, стоп
    await runQueueOnce(d); // успех → a1 удалён, дальше a2 удалён
    expect(store.get("a1")).toBeUndefined();
    expect(removed).toEqual(["a1", "a2"]);
  });
});

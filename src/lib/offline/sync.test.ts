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

// Собирает deps с заданным списком и поведением send; фиксирует вызовы remove/markConflict/auth.
function deps(list: QueuedAction[], send: QueueDeps["send"]): QueueDeps & {
  removed: string[];
  conflicts: { id: string; code: string }[];
  auth: string[];
} {
  const removed: string[] = [];
  const conflicts: { id: string; code: string }[] = [];
  const auth: string[] = [];
  return {
    list: () => Promise.resolve(list),
    send,
    remove: (id) => {
      removed.push(id);
      return Promise.resolve();
    },
    dropBlob: () => Promise.resolve(),
    markConflict: (a, e) => {
      conflicts.push({ id: a.id, code: e.code });
      return Promise.resolve();
    },
    onAuthRequired: () => auth.push("required"),
    onAuthOk: () => auth.push("ok"),
    removed,
    conflicts,
    auth,
  };
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

  it("5xx → тоже стоп без конфликта (сервер лёг, повтор поможет)", async () => {
    const d = deps([action({ id: "a1" })], () => Promise.reject(new ApiError("500", 503, "UNAVAILABLE")));
    const sent = await runQueueOnce(d);
    expect(sent).toBe(0);
    expect(d.conflicts).toEqual([]);
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

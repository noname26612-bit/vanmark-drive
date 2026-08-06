// Unit на enqueueOrSend/enqueuePhoto (инцидент «мёртвая кнопка» 31.07 + outbox-страховка 07.08):
//  - непустая очередь → новое действие в ХВОСТ (FIFO не обгоняется — иначе онлайн-DONE обгонял
//    застрявший «В работу» и ловил 409);
//  - онлайн-HTTP 500 → честная ошибка сразу, НЕ тихая очередь (решение Артёма 31.07);
//  - инфраструктурные 5xx/обрыв → в очередь, как раньше;
//  - страховка: перед прямой отправкой действие (и blob) пишется в IndexedDB со статусом "syncing"
//    и снимается после исхода — смерть страницы посреди fetch больше не теряет действие.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enqueueOrSend, enqueuePhoto } from "./send";
import { ApiError } from "@/lib/fetcher";
import type { QueuedAction } from "./types";

const apiSend = vi.fn();
const apiUpload = vi.fn();
vi.mock("@/lib/fetcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/fetcher")>();
  return { ...orig, apiSend: (...a: unknown[]) => apiSend(...a), apiUpload: (...a: unknown[]) => apiUpload(...a) };
});

const listQueue = vi.fn<() => Promise<QueuedAction[]>>();
const putQueued = vi.fn<(a: QueuedAction) => Promise<void>>();
const registerBackgroundSync = vi.fn(async () => undefined);
vi.mock("./queue", () => ({
  listQueue: () => listQueue(),
  putQueued: (a: QueuedAction) => putQueued(a),
  registerBackgroundSync: () => registerBackgroundSync(),
}));

// In-memory двойник IndexedDB: страховка (STORE_QUEUE) и blob (STORE_BLOBS) реально пишутся/читаются —
// sendAction восстанавливает FormData из сохранённого blob, тесты проверяют жизненный цикл записей.
const stores = new Map<string, Map<string, unknown>>();
const idb = {
  get: async (s: string, k: string) => stores.get(s)?.get(k),
  put: async (s: string, k: string, v: unknown) => {
    if (!stores.has(s)) stores.set(s, new Map());
    stores.get(s)!.set(k, v);
  },
  del: async (s: string, k: string) => {
    stores.get(s)?.delete(k);
  },
};
vi.mock("./db", () => ({
  STORE_BLOBS: "blobs",
  STORE_QUEUE: "queue",
  idbGet: (s: string, k: string) => idb.get(s, k),
  idbPut: (s: string, k: string, v: unknown) => idb.put(s, k, v),
  idbDelete: (s: string, k: string) => idb.del(s, k),
}));

const queueStore = () => stores.get("queue") ?? new Map();
const blobStore = () => stores.get("blobs") ?? new Map();

function queuedAction(over: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: "q1",
    seq: 1,
    kind: "transition",
    method: "POST",
    url: "/api/tasks/t/transition",
    occurredAt: "2026-07-31T10:00:00.000Z",
    taskId: "t",
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-31T10:00:00.000Z",
    ...over,
  };
}

const params = {
  kind: "transition" as const,
  method: "POST" as const,
  url: "/api/tasks/t/transition",
  taskId: "t",
  bodyJson: { toStatus: "DONE" },
};

beforeEach(() => {
  vi.clearAllMocks();
  stores.clear();
  listQueue.mockResolvedValue([]);
  putQueued.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { onLine: true });
});

describe("enqueueOrSend", () => {
  it("онлайн + пустая очередь → прямая отправка, после успеха страховка снята", async () => {
    apiSend.mockResolvedValue({});
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: false });
    expect(apiSend).toHaveBeenCalledOnce();
    expect(putQueued).not.toHaveBeenCalled();
    expect(queueStore().size).toBe(0); // страховка написана и снята
  });

  it("страховка живёт на время прямого fetch (status=syncing + directAt)", async () => {
    let snapshot: QueuedAction | undefined;
    apiSend.mockImplementation(async () => {
      snapshot = [...queueStore().values()][0] as QueuedAction; // что лежит в очереди в момент fetch
      return {};
    });
    await enqueueOrSend(params);
    expect(snapshot).toBeDefined();
    expect(snapshot?.status).toBe("syncing");
    expect(typeof snapshot?.directAt).toBe("string");
    expect(registerBackgroundSync).toHaveBeenCalled(); // SW подстрахует, если страница умрёт в полёте
  });

  it("непустая очередь (pending) → в хвост БЕЗ прямой отправки (FIFO не обгоняем)", async () => {
    listQueue.mockResolvedValue([queuedAction()]);
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: true });
    expect(apiSend).not.toHaveBeenCalled();
    expect(putQueued).toHaveBeenCalledOnce();
  });

  it("в очереди только conflict-записи → они не хвост, отправляем напрямую", async () => {
    listQueue.mockResolvedValue([queuedAction({ status: "conflict" })]);
    apiSend.mockResolvedValue({});
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: false });
    expect(apiSend).toHaveBeenCalledOnce();
  });

  it("офлайн → сразу в очередь", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: true });
    expect(apiSend).not.toHaveBeenCalled();
    expect(putQueued).toHaveBeenCalledOnce();
  });

  it("онлайн-HTTP 500 → ошибка наверх, страховка снята, очередь ПУСТА (не прячем отказ)", async () => {
    apiSend.mockRejectedValue(new ApiError("Ошибка сервера", 500, "INTERNAL"));
    await expect(enqueueOrSend(params)).rejects.toMatchObject({ status: 500 });
    expect(putQueued).not.toHaveBeenCalled();
    expect(queueStore().size).toBe(0);
  });

  it("онлайн-502 (деплой/прокси) → в очередь (страховка перезаписывается pending-ом, id тот же)", async () => {
    apiSend.mockRejectedValue(new ApiError("Bad gateway", 502, "HTTP_502"));
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: true });
    expect(putQueued).toHaveBeenCalledOnce();
    const insured = [...queueStore().values()][0] as QueuedAction; // страховка ещё лежит (тихая)
    const queued = putQueued.mock.calls[0][0];
    expect(queued.id).toBe(insured.id); // один id ⇒ putQueued перекрывает страховку, дубля нет
    expect(queued.status).toBe("pending");
  });

  it("обрыв/таймаут (status 0) → в очередь", async () => {
    apiSend.mockRejectedValue(new ApiError("Сеть не отвечает", 0, "TIMEOUT"));
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: true });
    expect(putQueued).toHaveBeenCalledOnce();
  });

  it("доменная 4xx → наверх, страховка снята, очередь пуста (как раньше)", async () => {
    apiSend.mockRejectedValue(new ApiError("Недопустимый переход", 409, "FORBIDDEN_TRANSITION"));
    await expect(enqueueOrSend(params)).rejects.toMatchObject({ status: 409 });
    expect(putQueued).not.toHaveBeenCalled();
    expect(queueStore().size).toBe(0);
  });
});

describe("enqueuePhoto", () => {
  const photoParams = {
    url: "/api/tasks/t/attachments",
    taskId: "t",
    blob: new Blob(["x"], { type: "image/jpeg" }),
    fileName: "p.jpg",
    kind: "PHOTO" as const,
  };

  it("онлайн-успех → blob сохранён на время загрузки и освобождён после; очередь чиста", async () => {
    let blobsDuringUpload = -1;
    apiUpload.mockImplementation(async () => {
      blobsDuringUpload = blobStore().size; // blob обязан лежать в IndexedDB, пока идёт fetch
      return {};
    });
    await expect(enqueuePhoto(photoParams)).resolves.toEqual({ queued: false });
    expect(blobsDuringUpload).toBe(1);
    expect(blobStore().size).toBe(0);
    expect(queueStore().size).toBe(0);
  });

  it("онлайн-HTTP 500 → ошибка наверх, blob и страховка освобождены", async () => {
    apiUpload.mockRejectedValue(new ApiError("Ошибка сервера", 500, "INTERNAL"));
    await expect(enqueuePhoto(photoParams)).rejects.toMatchObject({ status: 500 });
    expect(putQueued).not.toHaveBeenCalled();
    expect(blobStore().size).toBe(0);
    expect(queueStore().size).toBe(0);
  });

  it("непустая очередь → фото сразу в очередь, без прямой загрузки; blob сохранён", async () => {
    listQueue.mockResolvedValue([queuedAction()]);
    await expect(enqueuePhoto(photoParams)).resolves.toEqual({ queued: true });
    expect(apiUpload).not.toHaveBeenCalled();
    expect(putQueued).toHaveBeenCalledOnce();
    expect(blobStore().size).toBe(1);
  });

  it("онлайн-502 → действие в очередь, blob остаётся для досылки", async () => {
    apiUpload.mockRejectedValue(new ApiError("Bad gateway", 502, "HTTP_502"));
    await expect(enqueuePhoto(photoParams)).resolves.toEqual({ queued: true });
    expect(putQueued).toHaveBeenCalledOnce();
    expect(blobStore().size).toBe(1);
    const queued = putQueued.mock.calls[0][0];
    expect(queued.kind).toBe("attachment");
    expect(queued.status).toBe("pending");
  });
});

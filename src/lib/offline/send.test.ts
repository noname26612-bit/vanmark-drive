// Unit на enqueueOrSend/enqueuePhoto (инцидент «мёртвая кнопка», 31.07):
//  - непустая очередь → новое действие в ХВОСТ (FIFO не обгоняется — иначе онлайн-DONE обгонял
//    застрявший «В работу» и ловил 409);
//  - онлайн-HTTP 500 → честная ошибка сразу, НЕ тихая очередь (решение Артёма 31.07);
//  - инфраструктурные 5xx/обрыв → в очередь, как раньше.
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
vi.mock("./queue", () => ({
  listQueue: () => listQueue(),
  putQueued: (a: QueuedAction) => putQueued(a),
}));

vi.mock("./db", () => ({
  idbGet: vi.fn(async () => undefined),
  idbPut: vi.fn(async () => undefined),
  STORE_BLOBS: "blobs",
}));

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
  listQueue.mockResolvedValue([]);
  putQueued.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { onLine: true });
});

describe("enqueueOrSend", () => {
  it("онлайн + пустая очередь → прямая отправка, в очередь не кладём", async () => {
    apiSend.mockResolvedValue({});
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: false });
    expect(apiSend).toHaveBeenCalledOnce();
    expect(putQueued).not.toHaveBeenCalled();
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

  it("онлайн-HTTP 500 → ошибка наверх, очередь ПУСТА (не прячем детерминированный отказ)", async () => {
    apiSend.mockRejectedValue(new ApiError("Ошибка сервера", 500, "INTERNAL"));
    await expect(enqueueOrSend(params)).rejects.toMatchObject({ status: 500 });
    expect(putQueued).not.toHaveBeenCalled();
  });

  it("онлайн-502 (деплой/прокси) → в очередь", async () => {
    apiSend.mockRejectedValue(new ApiError("Bad gateway", 502, "HTTP_502"));
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: true });
    expect(putQueued).toHaveBeenCalledOnce();
  });

  it("обрыв/таймаут (status 0) → в очередь", async () => {
    apiSend.mockRejectedValue(new ApiError("Сеть не отвечает", 0, "TIMEOUT"));
    await expect(enqueueOrSend(params)).resolves.toEqual({ queued: true });
    expect(putQueued).toHaveBeenCalledOnce();
  });

  it("доменная 4xx → наверх, очередь пуста (как раньше)", async () => {
    apiSend.mockRejectedValue(new ApiError("Недопустимый переход", 409, "FORBIDDEN_TRANSITION"));
    await expect(enqueueOrSend(params)).rejects.toMatchObject({ status: 409 });
    expect(putQueued).not.toHaveBeenCalled();
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

  it("онлайн-HTTP 500 → ошибка наверх, blob не сохраняем", async () => {
    apiUpload.mockRejectedValue(new ApiError("Ошибка сервера", 500, "INTERNAL"));
    await expect(enqueuePhoto(photoParams)).rejects.toMatchObject({ status: 500 });
    expect(putQueued).not.toHaveBeenCalled();
  });

  it("непустая очередь → фото сразу в очередь, без прямой загрузки", async () => {
    listQueue.mockResolvedValue([queuedAction()]);
    await expect(enqueuePhoto(photoParams)).resolves.toEqual({ queued: true });
    expect(apiUpload).not.toHaveBeenCalled();
    expect(putQueued).toHaveBeenCalledOnce();
  });

  it("онлайн-502 → blob в IndexedDB и действие в очередь", async () => {
    apiUpload.mockRejectedValue(new ApiError("Bad gateway", 502, "HTTP_502"));
    await expect(enqueuePhoto(photoParams)).resolves.toEqual({ queued: true });
    expect(putQueued).toHaveBeenCalledOnce();
  });
});

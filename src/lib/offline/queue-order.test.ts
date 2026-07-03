// Unit на порядок очереди (O8): монотонный nextSeq и тай-брейк сортировки (seq, id).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { idbGetAll, idbPut, idbDelete } = vi.hoisted(() => ({
  idbGetAll: vi.fn(),
  idbPut: vi.fn(),
  idbDelete: vi.fn(),
}));
vi.mock("./db", () => ({
  idbGetAll,
  idbPut,
  idbDelete,
  STORE_QUEUE: "queue",
  STORE_BLOBS: "blobs",
}));

import { nextSeq } from "./send";
import { listQueue } from "./queue";
import type { QueuedAction } from "./types";

function action(id: string, seq: number): QueuedAction {
  return {
    id,
    seq,
    kind: "transition",
    method: "POST",
    url: "/u",
    occurredAt: "2026-07-02T10:00:00.000Z",
    taskId: "t",
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-02T10:00:00.000Z",
  };
}

describe("nextSeq — монотонность (O8)", () => {
  it("строго возрастает даже при вызовах в одну миллисекунду", () => {
    const a = nextSeq();
    const b = nextSeq();
    const c = nextSeq();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("listQueue — FIFO с тай-брейком по id (O8)", () => {
  beforeEach(() => idbGetAll.mockReset());

  it("сортирует по seq, при равном seq — по id (легаси-записи с голым Date.now())", async () => {
    idbGetAll.mockResolvedValue([
      action("z", 100),
      action("a", 100), // тот же seq — порядок решает id
      action("m", 50),
    ]);
    const order = (await listQueue()).map((x) => x.id);
    expect(order).toEqual(["m", "a", "z"]);
  });
});

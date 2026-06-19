import { describe, it, expect } from "vitest";
import { mergeOrder, moveTo } from "./pool-order";

describe("mergeOrder", () => {
  it("сохранённый порядок известных ключей + новые в конец", () => {
    expect(mergeOrder(["b", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });

  it("отбрасывает пропавшие ключи", () => {
    expect(mergeOrder(["x", "a", "y"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("пустой сохранённый → естественный порядок", () => {
    expect(mergeOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("несколько новых ключей идут в их исходном порядке", () => {
    expect(mergeOrder(["c"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
  });
});

describe("moveTo", () => {
  it("перемещает влево (вставка перед target)", () => {
    expect(moveTo(["a", "b", "c", "d"], "c", "a")).toEqual(["c", "a", "b", "d"]);
  });

  it("перемещает вправо (вставка перед target)", () => {
    expect(moveTo(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "a", "c", "d"]);
  });

  it("тот же ключ — без изменений", () => {
    expect(moveTo(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });

  it("неизвестный target — без изменений", () => {
    expect(moveTo(["a", "b"], "a", "z")).toEqual(["a", "b"]);
  });
});

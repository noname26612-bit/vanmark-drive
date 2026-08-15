import { describe, it, expect } from "vitest";
import { buildShopTaskText, type ShopTaskMachine } from "./machine-shop-task";

const machine = (over: Partial<ShopTaskMachine> = {}): ShopTaskMachine => ({
  ourNumber: 3,
  clientNumber: null,
  category: "OUR_SALE",
  invoice1C: null,
  kind: "MACHINE",
  model: "ЛБМ 200",
  metalThickness: "1,5 мм",
  configuration: "без ножа",
  location: "ряд Б-2",
  defectNotes: "не крутится вал, разбит подшипник",
  isUrgent: false,
  dueDate: "2026-08-09",
  ...over,
});

describe("machine-shop-task: текст задания в цех", () => {
  it("собирает полное задание из карточки и комментария", () => {
    expect(buildShopTaskText(machine(), "заменить подшипник, отрегулировать прижим")).toBe(
      [
        "В цех — 77-3",
        "Модель: ЛБМ 200",
        "Металл: 1,5 мм",
        "Комплектация: без ножа",
        "Место: ряд Б-2",
        "Дефектовка: не крутится вал, разбит подшипник",
        "Что сделать: заменить подшипник, отрегулировать прижим",
        "Срок: 09.08.2026",
      ].join("\n"),
    );
  });

  it("«СРОЧНО!» — первой строкой у срочного станка", () => {
    const text = buildShopTaskText(machine({ isUrgent: true }), null);
    expect(text.split("\n")[0]).toBe("СРОЧНО!");
  });

  it("пустые поля пропускаются: минимальная карточка даёт короткий текст без дыр", () => {
    const text = buildShopTaskText(
      machine({
        ourNumber: null,
        metalThickness: null,
        configuration: "  ",
        location: null,
        defectNotes: null,
        dueDate: null,
      }),
      "   ",
    );
    expect(text).toBe(["В цех — ЛБМ 200", "Модель: ЛБМ 200"].join("\n"));
  });

  it("клиентский станок подписан заказом 1С", () => {
    const text = buildShopTaskText(machine({ ourNumber: null, invoice1C: "4512" }), null);
    expect(text.split("\n")[0]).toBe("В цех — заказ 4512");
  });

  it("роликовый нож отмечен видом — цех должен понимать, что приедет", () => {
    const text = buildShopTaskText(machine({ kind: "ROLLER_KNIFE" }), null);
    expect(text.split("\n")[1]).toBe("Роликовый нож");
  });

  it("срок принимает и Date с сервера, и строку из DTO", () => {
    const fromDate = buildShopTaskText(
      machine({ dueDate: new Date("2026-08-09T00:00:00.000Z") }),
      null,
    );
    const fromString = buildShopTaskText(machine({ dueDate: "2026-08-09" }), null);
    expect(fromDate).toContain("Срок: 09.08.2026");
    expect(fromDate).toBe(fromString);
  });
});

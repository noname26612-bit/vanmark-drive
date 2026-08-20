import { describe, it, expect } from "vitest";
import { buildShopTaskText, type ShopTaskMachine } from "./machine-shop-task";

const machine = (over: Partial<ShopTaskMachine> = {}): ShopTaskMachine => ({
  ourNumber: 3,
  clientNumber: null,
  invoice1C: null,
  kind: "MACHINE",
  model: "ЛБМ 200",
  metalThickness: "1,5 мм",
  configuration: "без ножа",
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
        "Дефектовка: не крутится вал, разбит подшипник",
        "Что сделать: заменить подшипник, отрегулировать прижим",
        "Срок: 09.08.2026",
      ].join("\n"),
    );
  });

  it("строки «Место» в задании больше нет — поле выведено из карточки", () => {
    // Место на площадке перестали вести (20.08.2026): станки стоят там, где встали, и строка в
    // задании только вводила цех в заблуждение.
    expect(buildShopTaskText(machine(), "почистить")).not.toContain("Место");
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
        defectNotes: null,
        dueDate: null,
      }),
      "   ",
    );
    expect(text).toBe(["В цех — ЛБМ 200", "Модель: ЛБМ 200"].join("\n"));
  });

  it("клиентский станок подписан своим номером «К-N»", () => {
    const text = buildShopTaskText(machine({ ourNumber: null, clientNumber: 7 }), null);
    expect(text.split("\n")[0]).toBe("В цех — К-7");
  });

  it("карточка без номера подписана заказом 1С", () => {
    const text = buildShopTaskText(machine({ ourNumber: null, invoice1C: "4512" }), null);
    expect(text.split("\n")[0]).toBe("В цех — заказ 4512");
  });

  it("роликовый нож отмечен видом — цех должен понимать, что приедет", () => {
    const text = buildShopTaskText(machine({ kind: "ROLLER_KNIFE" }), null);
    expect(text.split("\n")[1]).toBe("Роликовый нож");
  });

  it("фальц машинка тоже отмечена видом", () => {
    const text = buildShopTaskText(machine({ kind: "FALZ_MACHINE" }), null);
    expect(text.split("\n")[1]).toBe("Фальц машинка");
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

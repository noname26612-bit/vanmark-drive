import { describe, it, expect } from "vitest";
import { emptyForm, isDirtyForm, draftLabel } from "./task-draft";

describe("task-draft: emptyForm", () => {
  it("возвращает пустую форму с заданными типом/датой/требованием акта", () => {
    const f = emptyForm("type-1", "2026-07-04", true);
    expect(f.typeId).toBe("type-1");
    expect(f.scheduledDate).toBe("2026-07-04");
    expect(f.requiresAct).toBe(true);
    expect(f.title).toBe("");
    expect(f.paymentType).toBe("NONE");
    expect(f.passStatus).toBe("NOT_NEEDED");
  });
});

describe("task-draft: isDirtyForm", () => {
  it("пустая форма (только тип и дата) — не грязная", () => {
    expect(isDirtyForm(emptyForm("type-1", "2026-07-04", false))).toBe(false);
    // requiresAct=true сам по себе (дефолт типа) не делает форму грязной
    expect(isDirtyForm(emptyForm("type-1", "2026-07-04", true))).toBe(false);
  });

  it("заполненное текстовое поле делает форму грязной", () => {
    expect(isDirtyForm({ ...emptyForm("t", "2026-07-04", false), title: "ЛБМ 200" })).toBe(true);
    expect(isDirtyForm({ ...emptyForm("t", "2026-07-04", false), address: "Москва" })).toBe(true);
    expect(isDirtyForm({ ...emptyForm("t", "2026-07-04", false), contactPhone: "+7900" })).toBe(true);
  });

  it("пробелы в тексте не считаются вводом", () => {
    expect(isDirtyForm({ ...emptyForm("t", "2026-07-04", false), title: "   " })).toBe(false);
  });

  it("осознанные отклонения селектов/флагов от дефолта делают форму грязной", () => {
    expect(isDirtyForm({ ...emptyForm("t", "2026-07-04", false), assigneeId: "driver-1" })).toBe(true);
    expect(isDirtyForm({ ...emptyForm("t", "2026-07-04", false), priority: true })).toBe(true);
    expect(isDirtyForm({ ...emptyForm("t", "2026-07-04", false), paymentType: "OFFICE" })).toBe(true);
    expect(isDirtyForm({ ...emptyForm("t", "2026-07-04", false), passStatus: "NEEDED" })).toBe(true);
  });
});

describe("task-draft: draftLabel", () => {
  it("подпись: название → адрес → заглушка", () => {
    expect(draftLabel({ ...emptyForm("t", "2026-07-04", false), title: "ЛБМ 200" })).toBe("ЛБМ 200");
    expect(draftLabel({ ...emptyForm("t", "2026-07-04", false), address: "Москва, ул. X" })).toBe(
      "Москва, ул. X",
    );
    expect(draftLabel(emptyForm("t", "2026-07-04", false))).toBe("Черновик заявки");
  });
});

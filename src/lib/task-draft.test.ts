import { describe, it, expect } from "vitest";
import {
  copyHint,
  copyTitle,
  draftLabel,
  emptyForm,
  formForCopy,
  formFromTask,
  isDirtyForm,
  type CopySource,
} from "./task-draft";
import type { TaskTypeDTO } from "./task-dto";

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

// ——— Копирование задачи (22.08.2026) ———

const TYPE_DELIVERY: TaskTypeDTO = {
  id: "type-delivery",
  name: "Доставка проданного об.",
  icon: null,
  kind: "DELIVERY",
  requiresSignedDoc: true,
  requiresPricing: false,
  onSiteMinutes: 60,
  machineFlow: "SOLD_DELIVERY",
};

const TYPE_RENTAL: TaskTypeDTO = {
  ...TYPE_DELIVERY,
  id: "type-rental",
  name: "Доставка / забор из аренды",
  machineFlow: "RENTAL",
};

function source(over: Partial<CopySource> = {}): CopySource {
  return {
    id: "task-1",
    number: 615,
    kind: "DELIVERY",
    title: "ЛБМ 200 + нож",
    description: "Позвонить за час",
    equipment: "ЛБМ 200",
    orgName: "ООО Кровля",
    contactName: "Иван",
    contactPhone: "+7 900 000-00-00",
    address: "Москва, ул. Ленина, 1",
    addressLink: "https://maps.example/1",
    invoiceNumber: "СЧ-42",
    paymentType: "ON_SITE",
    paymentAmount: 5000,
    paymentNote: "наличные",
    paymentReceived: true,
    scheduledDate: "2026-08-01",
    timeFrom: "09:00",
    timeTo: "12:00",
    timeNote: "после обеда не пускают",
    passStatus: "NEEDED",
    priority: true,
    lat: null,
    lng: null,
    estimatedMinutes: 120,
    estimateIsManual: false,
    requiresSignedDoc: true,
    actWaivedNote: null,
    carrierCost: 3000,
    worksheetStatus: null,
    status: "DONE",
    assigneeId: "driver-1",
    assignee: { id: "driver-1", name: "Каширский", login: "kashirskiy" },
    coDriverId: "driver-2",
    coDriver: { id: "driver-2", name: "Писарев", login: "pisarev" },
    createdById: "milena",
    createdBy: { name: "Милена" },
    cancelReason: null,
    holdReason: null,
    archivedAt: null,
    archivedById: null,
    createdAt: "2026-08-01T06:00:00.000Z",
    updatedAt: "2026-08-01T15:00:00.000Z",
    completedAt: "2026-08-01T15:00:00.000Z",
    type: TYPE_DELIVERY,
    ...over,
  };
}

describe("task-draft: formFromTask", () => {
  it("пустые поля задачи приходят в форму пустыми строками, числа — строками", () => {
    const f = formFromTask(
      source({ description: null, paymentAmount: null, carrierCost: null, scheduledDate: null }),
    );
    expect(f.description).toBe("");
    expect(f.paymentAmount).toBe("");
    expect(f.carrierCost).toBe("");
    expect(f.scheduledDate).toBe("");
  });

  it("дата режется до дня, суммы становятся строками, станки получают подпись", () => {
    const f = formFromTask(
      source({
        scheduledDate: "2026-08-01T00:00:00.000Z",
        machines: [
          {
            machineId: "m1",
            direction: "OUT",
            machine: { ourNumber: 5, clientNumber: null, model: "ЛБМ 200" },
          },
        ],
      }),
    );
    expect(f.scheduledDate).toBe("2026-08-01");
    expect(f.paymentAmount).toBe("5000");
    expect(f.carrierCost).toBe("3000");
    expect(f.machines).toEqual([{ machineId: "m1", direction: "OUT", label: "77-5 · ЛБМ 200" }]);
  });
});

describe("task-draft: formForCopy", () => {
  const opts = { types: [TYPE_DELIVERY, TYPE_RENTAL], today: "2026-08-22" };

  it("дата = сегодня, исполнитель, напарник и стоимость перевозчика не наследуются", () => {
    const { form } = formForCopy(source(), opts);
    expect(form.scheduledDate).toBe("2026-08-22");
    expect(form.assigneeId).toBe("");
    expect(form.coDriverId).toBe("");
    expect(form.carrierCost).toBe("");
  });

  it("суть, клиент, адрес, счёт, оплата, окно, пропуск, срочность и акт копируются", () => {
    const { form } = formForCopy(source(), opts);
    expect(form.typeId).toBe("type-delivery");
    expect(form.title).toBe("ЛБМ 200 + нож");
    expect(form.address).toBe("Москва, ул. Ленина, 1");
    expect(form.orgName).toBe("ООО Кровля");
    expect(form.contactPhone).toBe("+7 900 000-00-00");
    expect(form.invoiceNumber).toBe("СЧ-42");
    expect(form.paymentType).toBe("ON_SITE");
    expect(form.paymentAmount).toBe("5000");
    expect(form.timeFrom).toBe("09:00");
    expect(form.timeTo).toBe("12:00");
    expect(form.timeNote).toBe("после обеда не пускают");
    expect(form.passStatus).toBe("NEEDED");
    expect(form.priority).toBe(true);
    expect(form.requiresAct).toBe(true);
  });

  it("направление станка пересчитывается по его состоянию, если оно известно (карточка)", () => {
    const { form } = formForCopy(
      source({
        type: TYPE_RENTAL,
        machines: [
          {
            machineId: "m1",
            direction: "OUT",
            machine: { ourNumber: 5, clientNumber: null, model: "ЛБМ 200", status: "RENTED" },
          },
        ],
      }),
      opts,
    );
    // Станок уже у клиента — копия «забираем к нам», хотя в исходной заявке его везли туда.
    expect(form.machines).toEqual([{ machineId: "m1", direction: "IN", label: "77-5 · ЛБМ 200" }]);
  });

  it("без состояния станка (строка списка) направление остаётся прежним", () => {
    const { form } = formForCopy(
      source({
        type: TYPE_RENTAL,
        machines: [
          {
            machineId: "m1",
            direction: "IN",
            machine: { ourNumber: null, clientNumber: 7, model: "ЛБМ 200" },
          },
        ],
      }),
      opts,
    );
    expect(form.machines).toEqual([{ machineId: "m1", direction: "IN", label: "К-7 · ЛБМ 200" }]);
  });

  it("жёсткое направление типа перекрывает состояние станка", () => {
    const { form } = formForCopy(
      source({
        machines: [
          {
            machineId: "m1",
            direction: "IN",
            machine: { ourNumber: 5, clientNumber: null, model: "ЛБМ 200", status: "RENTED" },
          },
        ],
      }),
      opts,
    );
    // Проданное всегда уезжает — SOLD_DELIVERY нормализует направление в OUT.
    expect(form.machines[0].direction).toBe("OUT");
  });

  it("выключенный тип заменяется первым активным и называется в результате", () => {
    const dead = { ...TYPE_DELIVERY, id: "type-dead", name: "Старый тип" };
    const { form, replacedTypeName } = formForCopy(source({ type: dead }), opts);
    expect(form.typeId).toBe("type-delivery");
    expect(replacedTypeName).toBe("Старый тип");
  });

  it("живой тип ничем не заменяется", () => {
    expect(formForCopy(source(), opts).replacedTypeName).toBeNull();
  });

  it("копия не тащит статус, историю и факт оплаты — в форме их полей нет", () => {
    const { form } = formForCopy(source(), opts);
    expect(Object.keys(form)).not.toContain("status");
    expect(Object.keys(form)).not.toContain("paymentReceived");
  });
});

describe("task-draft: подписи копии", () => {
  it("заголовок различает заявку и задачу цеха", () => {
    expect(copyTitle(source())).toBe("Копия заявки №615");
    expect(copyTitle(source({ kind: "STAFF", staffNumber: 5 }))).toBe("Копия задачи Ц-5");
  });

  it("подсказка называет источник и просит проверить дату, исполнителя и оплату", () => {
    expect(copyHint(source(), null)).toBe(
      "Скопировано из заявки №615 — проверьте дату, исполнителя и оплату.",
    );
  });

  it("подсказка предупреждает о выключенном типе", () => {
    expect(copyHint(source(), "Старый тип")).toContain("Тип «Старый тип» отключён");
  });
});

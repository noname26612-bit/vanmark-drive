import { describe, it, expect } from "vitest";
import {
  firstHiddenMachineMatch,
  formatOurNumber,
  machineMatches,
  parseQuery,
  type SearchableMachine,
} from "./machine-search";

const m = (over: Partial<SearchableMachine> = {}): SearchableMachine => ({
  number: 213,
  ourNumber: null,
  kind: "MACHINE",
  category: "CLIENT",
  status: "IN_REPAIR",
  model: "ЛБМ 200",
  configuration: "нож, дог. машинка",
  metalThickness: "0,7 мм",
  serialNumber: "SN-98211",
  orgName: "ДОМОСТРОЙ ЛОГИСТИК ООО",
  contactName: "Павел",
  contactPhone: "+7 915 327-57-16",
  invoice1C: "4512",
  location: "Ряд Б, место 3",
  deliveredBy: "Каширский",
  defectNotes: "не гнёт край",
  notes: null,
  ...over,
});

const find = (machine: SearchableMachine, q: string) => machineMatches(machine, parseQuery(q));

describe("machine-search: номера", () => {
  it("находит по учётному номеру, в том числе с решёткой", () => {
    expect(find(m(), "213")).toBe(true);
    expect(find(m(), "№213")).toBe(true);
    expect(find(m(), "999")).toBe(false);
  });

  it("находит наш станок по маркировке «77-N»", () => {
    const our = m({ category: "OUR_SALE", ourNumber: 5, number: 214 });
    expect(find(our, "77-5")).toBe(true);
    expect(find(our, "77-6")).toBe(false);
  });

  it("находит по № заказа 1С", () => {
    expect(find(m(), "4512")).toBe(true);
  });

  it("находит по серийному номеру", () => {
    expect(find(m(), "98211")).toBe(true);
    expect(find(m(), "SN-98211")).toBe(true);
  });
});

describe("machine-search: текст", () => {
  it("ищет по модели без учёта регистра", () => {
    expect(find(m(), "лбм")).toBe(true);
    expect(find(m(), "ЛБМ 200")).toBe(true);
  });

  it("ищет по заказчику, месту, комплектации и дефектовке", () => {
    expect(find(m(), "домострой")).toBe(true);
    expect(find(m(), "ряд б")).toBe(true);
    expect(find(m(), "нож")).toBe(true);
    expect(find(m(), "гнёт")).toBe(true);
  });

  it("ё и е не различаются", () => {
    expect(find(m({ model: "Клён 300" }), "клен")).toBe(true);
    expect(find(m({ model: "Клен 300" }), "клён")).toBe(true);
  });

  it("чинит неверную раскладку: «lj,jcnhjq» → «домострой»", () => {
    expect(find(m(), "ljvjcnhjq")).toBe(true);
  });

  it("несколько слов — все должны найтись (AND)", () => {
    expect(find(m(), "лбм домострой")).toBe(true);
    expect(find(m(), "лбм сорекс")).toBe(false);
  });

  it("ищет по подписи состояния и категории", () => {
    expect(find(m({ status: "IN_REPAIR" }), "в ремонте")).toBe(true);
    expect(find(m({ category: "OUR_RENTAL" }), "арендный")).toBe(true);
  });

  it("роликовый нож находится по виду — даже без слова «нож» в полях", () => {
    const knife = m({ kind: "ROLLER_KNIFE", model: "LBA 2007", configuration: null, defectNotes: null });
    expect(find(knife, "нож")).toBe(true);
    expect(find(knife, "роликовый")).toBe(true);
  });

  it("подпись вида не вешается на станки: «роликовый» чужой станок не находит", () => {
    const machineOnly = m({ configuration: null, defectNotes: null });
    expect(find(machineOnly, "роликовый")).toBe(false);
  });

  it("пустой запрос показывает всё", () => {
    expect(find(m(), "")).toBe(true);
    expect(find(m(), "   ")).toBe(true);
  });
});

describe("machine-search: телефон", () => {
  it("находит в любом формате записи", () => {
    expect(find(m(), "9153275716")).toBe(true);
    expect(find(m(), "+7 915 327-57-16")).toBe(true);
    expect(find(m(), "327-57-16")).toBe(true);
  });

  it("«8…» и «+7…» — один и тот же номер", () => {
    expect(find(m({ contactPhone: "8 915 327-57-16" }), "+79153275716")).toBe(true);
    expect(find(m({ contactPhone: "+7 915 327-57-16" }), "89153275716")).toBe(true);
  });

  it("чужой номер не находится", () => {
    expect(find(m(), "9990001122")).toBe(false);
  });
});

describe("machine-search: сниппет «почему нашлось»", () => {
  const visible = ["ЛБМ 200", "Ряд Б, место 3"];

  it("совпадение по видимому полю сниппета не даёт", () => {
    expect(firstHiddenMachineMatch(m(), parseQuery("лбм"), visible)).toBeNull();
    expect(firstHiddenMachineMatch(m(), parseQuery("213"), visible)).toBeNull();
  });

  it("совпадение по телефону показывает телефон", () => {
    const hit = firstHiddenMachineMatch(m(), parseQuery("3275716"), visible);
    expect(hit?.label).toBe("Тел.");
    expect(hit?.phone).toBe(true);
  });

  it("совпадение по заказчику показывает заказчика", () => {
    const hit = firstHiddenMachineMatch(m(), parseQuery("домострой"), visible);
    expect(hit?.label).toBe("Заказчик");
    expect(hit?.text).toContain("ДОМОСТРОЙ");
  });

  it("совпадение по заказу 1С показывает заказ", () => {
    expect(firstHiddenMachineMatch(m(), parseQuery("4512"), visible)?.label).toBe("Заказ 1С");
  });
});

describe("machine-search: маркировка", () => {
  it("наш номер отображается как «77-N», у клиентских его нет", () => {
    expect(formatOurNumber(5)).toBe("77-5");
    expect(formatOurNumber(null)).toBeNull();
  });
});

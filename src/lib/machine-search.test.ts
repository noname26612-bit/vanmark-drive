import { describe, it, expect } from "vitest";
import {
  firstHiddenMachineMatch,
  formatOurNumber,
  machineMatches,
  parseQuery,
  type SearchableMachine,
} from "./machine-search";

const m = (over: Partial<SearchableMachine> = {}): SearchableMachine => ({
  ourNumber: null,
  clientNumber: null,
  kind: "MACHINE",
  categories: ["CLIENT"],
  status: "IN_REPAIR",
  model: "ЛБМ 200",
  configuration: "нож, дог. машинка",
  metalThickness: "0,7 мм",
  contactName: "Павел Домостроев",
  invoice1C: "4512",
  deliveredBy: "Каширский",
  defectNotes: "не гнёт край",
  notes: null,
  ...over,
});

const find = (machine: SearchableMachine, q: string) => machineMatches(machine, parseQuery(q));

describe("machine-search: номера", () => {
  it("находит по учётному номеру, в том числе с решёткой", () => {
    const our = m({ categories: ["OUR_SALE"], ourNumber: 213 });
    expect(find(our, "213")).toBe(true);
    expect(find(our, "№213")).toBe(true);
    expect(find(our, "999")).toBe(false);
  });

  it("находит станок по маркировке «77-N»", () => {
    const our = m({ categories: ["OUR_SALE"], ourNumber: 5 });
    expect(find(our, "77-5")).toBe(true);
    expect(find(our, "77-6")).toBe(false);
  });

  it("клиентский находится по «К-N» в любом написании и раскладке", () => {
    const client = m({ clientNumber: 5, invoice1C: null });
    expect(find(client, "к-5")).toBe(true);
    expect(find(client, "к5")).toBe(true);
    expect(find(client, "k5")).toBe(true); // забытая раскладка
    expect(find(client, "к-6")).toBe(false);
  });

  // Сквозной системный номер убран из интерфейса и из поиска (15.08.2026): человек его нигде не
  // видит, а совпадения по нему выглядели бы как случайные.
  it("не ищет по сквозному системному номеру", () => {
    expect(find(m({ ourNumber: null, invoice1C: null }), "213")).toBe(false);
  });

  it("находит по № заказа 1С", () => {
    expect(find(m(), "4512")).toBe(true);
  });
});

describe("machine-search: текст", () => {
  it("ищет по модели без учёта регистра", () => {
    expect(find(m(), "лбм")).toBe(true);
    expect(find(m(), "ЛБМ 200")).toBe(true);
  });

  it("ищет по контакту, комплектации, дефектовке и тому, кто привёз", () => {
    expect(find(m(), "павел")).toBe(true);
    expect(find(m(), "нож")).toBe(true);
    expect(find(m(), "гнёт")).toBe(true);
    expect(find(m(), "каширский")).toBe(true);
  });

  it("ё и е не различаются", () => {
    expect(find(m({ model: "Клён 300" }), "клен")).toBe(true);
    expect(find(m({ model: "Клен 300" }), "клён")).toBe(true);
  });

  it("чинит неверную раскладку: «ljvjcnhj» → «домострой»", () => {
    expect(find(m(), "ljvjcnhj")).toBe(true);
  });

  it("несколько слов — все должны найтись (AND)", () => {
    expect(find(m(), "лбм домостроев")).toBe(true);
    expect(find(m(), "лбм сорекс")).toBe(false);
  });

  it("пустой запрос показывает всё", () => {
    expect(find(m(), "")).toBe(true);
    expect(find(m(), "   ")).toBe(true);
  });
});

// Телефон, заказчик, серийник и место выведены из карточки 20.08.2026 — искать по ним больше
// нечего. Тест держит границу: цифровой путь остался только у номера и заказа 1С.
describe("machine-search: снятые поля", () => {
  it("телефонный запрос больше ничего не находит", () => {
    expect(find(m(), "9153275716")).toBe(false);
    expect(find(m(), "+7 915 327-57-16")).toBe(false);
    expect(find(m(), "327-57-16")).toBe(false);
  });
});

describe("machine-search: подписи состояния, категорий и вида", () => {
  it("ищет по подписи состояния", () => {
    expect(find(m({ status: "IN_REPAIR" }), "в ремонте")).toBe(true);
    expect(find(m({ status: "READY" }), "в ремонте")).toBe(false);
  });

  it("станок с двумя категориями находится по подписи ЛЮБОЙ из них", () => {
    const dual = m({ categories: ["OUR_SALE", "OUR_RENTAL"] });
    expect(find(dual, "арендный")).toBe(true);
    expect(find(dual, "на продажу")).toBe(true);
    expect(find(dual, "клиентский")).toBe(false);
  });

  it("одиночная категория ищется как раньше", () => {
    expect(find(m({ categories: ["OUR_RENTAL"] }), "арендный")).toBe(true);
    expect(find(m({ categories: ["OUR_SALE"] }), "арендный")).toBe(false);
  });

  it("роликовый нож находится по виду — даже без слова «нож» в полях", () => {
    const knife = m({ kind: "ROLLER_KNIFE", model: "LBA 2007", configuration: null, defectNotes: null });
    expect(find(knife, "нож")).toBe(true);
    expect(find(knife, "роликовый")).toBe(true);
  });

  it("фальц машинка находится по своему виду", () => {
    const falz = m({ kind: "FALZ_MACHINE", model: "Van Mark", configuration: null, defectNotes: null });
    expect(find(falz, "фальц")).toBe(true);
    expect(find(falz, "машинка")).toBe(true);
  });

  it("подпись вида не вешается на станки: «роликовый» чужой станок не находит", () => {
    const machineOnly = m({ configuration: null, defectNotes: null });
    expect(find(machineOnly, "роликовый")).toBe(false);
  });
});

describe("machine-search: сниппет «почему нашлось»", () => {
  const visible = ["ЛБМ 200", "0,7 мм"];

  it("совпадение по видимому полю сниппета не даёт", () => {
    expect(firstHiddenMachineMatch(m(), parseQuery("лбм"), visible)).toBeNull();
    expect(
      firstHiddenMachineMatch(m({ ourNumber: 213 }), parseQuery("213"), visible),
    ).toBeNull();
  });

  it("совпадение по контакту показывает контакт", () => {
    const hit = firstHiddenMachineMatch(m(), parseQuery("павел"), visible);
    expect(hit?.label).toBe("Контакт");
    expect(hit?.text).toContain("Павел");
  });

  it("совпадение по заказу 1С показывает заказ", () => {
    expect(firstHiddenMachineMatch(m(), parseQuery("4512"), visible)?.label).toBe("Заказ 1С");
  });

  it("совпадение по комплектации и дефектовке подписано своими метками", () => {
    expect(firstHiddenMachineMatch(m(), parseQuery("дог"), visible)?.label).toBe("Компл.");
    expect(firstHiddenMachineMatch(m(), parseQuery("гнёт"), visible)?.label).toBe("Дефект");
  });

  it("без активного запроса сниппета нет", () => {
    expect(firstHiddenMachineMatch(m(), parseQuery("   "), visible)).toBeNull();
  });
});

describe("machine-search: маркировка", () => {
  it("номер отображается по заполненному полю: своё «77-N», чужое «К-N»", () => {
    expect(formatOurNumber({ ourNumber: 5, clientNumber: null })).toBe("77-5");
    expect(formatOurNumber({ ourNumber: null, clientNumber: 5 })).toBe("К-5");
    expect(formatOurNumber({ ourNumber: null, clientNumber: null })).toBeNull();
  });
});

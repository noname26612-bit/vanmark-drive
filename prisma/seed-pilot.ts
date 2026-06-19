// Имитация пилота (Этап 8): заводит реальные задачи из чата «Доставки», раскидывает по дням,
// назначает водителям, прогоняет статусы с историей/фото/актами и закладывает реалистичные
// нарушения KPI; затем прогоняет ночной детектор за прошедшие дни, имитирует решения Милены
// и сводит расчёт. Идемпотентно по title — повторный запуск переигрывает чисто.
// Запуск: `pnpm db:seed:pilot`. ВНИМАНИЕ: создаёт боевые задачи — для имитации на проде.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { detectCandidatesForDate, resolveMark, addManualMark, getKpiOverview } from "@/domain/kpi-service";
import type { PassStatus, PaymentType, TaskStatus } from "@/generated/prisma/enums";

// Базовый день имитации (сегодня для сценария). Прошлые дни — завершённые, будущие — назначенные.
const BASE_DAY = "2026-06-17";

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
    "AAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

type Sim = {
  status: TaskStatus; // финальный статус задачи в имитации
  lateOnSite?: boolean; // взят в работу позже timeTo (→ нарушение «опоздание»)
  withPhoto?: boolean; // приложить фото-отчёт (для requiresPhoto при DONE)
  withAct?: boolean; // приложить подписанный акт (ремонтные типы)
};

type PilotTask = {
  ref: string; // номер из чата (для логов)
  type: string; // имя типа задачи
  title: string;
  equipment?: string;
  orgName?: string;
  contactName?: string;
  contactPhone?: string;
  address: string;
  addressLink?: string;
  invoiceNumber?: string;
  paymentType?: PaymentType;
  paymentAmount?: number;
  paymentNote?: string;
  dayOffset: number; // от BASE_DAY
  timeFrom?: string;
  timeTo?: string;
  timeNote?: string;
  passStatus?: PassStatus;
  driver: "kashirskiy" | "pisarev" | "sultan";
  sim: Sim;
};

const D = (s: TaskStatus, extra: Omit<Sim, "status"> = {}): Sim => ({ status: s, ...extra });

// Задачи из реального чата «Доставки» (501, 513–530), разобранные по полям.
const TASKS: PilotTask[] = [
  // ── 15 июня (dayOffset −2): завершённый день ──
  { ref: "513", type: "Выездной ремонт / диагностика", title: "Ремонт/настройка ЛБМ / Профи с ножами",
    orgName: "Триал ООО", contactPhone: "+79529920839", address: "Москва, Перово, 2-я Владимирская ул., 30",
    dayOffset: -2, driver: "kashirskiy", sim: D("DONE", { withPhoto: true, withAct: true }) },
  { ref: "514", type: "Доставка в аренду", title: "Доставка станка", address: "Москва, Косинское шоссе, 17",
    contactPhone: "89364440028", paymentType: "ON_SITE", dayOffset: -2, driver: "pisarev",
    sim: D("DONE", { withPhoto: true, withAct: false }) }, // без акта → нарушение
  { ref: "515", type: "Выездной ремонт / диагностика", title: "Настройка нашего станка ЛБМ 300 в аренде (взять нож)",
    address: "Москва, Смольная ул., 36", contactPhone: "+79370100010", dayOffset: -2, driver: "kashirskiy",
    sim: D("DONE", { withPhoto: true, withAct: false }) }, // без акта → нарушение
  { ref: "516", type: "Прочее", title: "Забрать с аренды нож + дог. маш.", contactName: "Павел",
    contactPhone: "+79163263046", address: "Москва, 3-й Силикатный проезд, 6к1с3", dayOffset: -2,
    driver: "sultan", sim: D("ASSIGNED") }, // не доведена → «невыполненная точка» (Султан, вне расчёта)

  // ── 16 июня (dayOffset −1): завершённый день ──
  { ref: "517", type: "Выездной ремонт / диагностика", title: "Ремонт/настройка наш станок в аренде ЛБМ 200 (вытягивает металл)",
    orgName: "ДОМОСТРОЙ ЛОГИСТИК ООО", contactName: "Павел", contactPhone: "+79153275716",
    address: "Москва, ул. Лётчика Бабушкина, 33, к.3", timeTo: "14:00", dayOffset: -1, driver: "kashirskiy",
    sim: D("DONE", { withPhoto: true, withAct: true, lateOnSite: true }) }, // опоздание
  { ref: "518a", type: "Выездной ремонт / диагностика", title: "Ремонт ЛБМ 200 с ножом (возможно капиталка; пружины с собой)",
    contactName: "Павел", contactPhone: "+79250720700", address: "Люберецкий р-н, Строительный рынок Егорка",
    paymentType: "OFFICE", dayOffset: -1, driver: "pisarev", sim: D("ON_HOLD") }, // зависла → «невыполненная точка»
  { ref: "518b", type: "Прочее", title: "Забрать с аренды ЛБМ 200 + дог.маш и ЛБМ 300 + дог.маш (снять с этажа)",
    contactName: "Ильдус", contactPhone: "+79250004212", address: "Москва, Коломенская набережная, 20",
    dayOffset: -1, driver: "sultan", sim: D("DONE", { withPhoto: true }) },
  { ref: "519", type: "Прочее", title: "Забрать с аренды ЛБМ 300 + нож + дог.маш + размотчик",
    contactName: "Шодлик", contactPhone: "+79775777021", address: "МО, Ленинский ГО, пос. Мещерино, мкр Южные Горки",
    paymentType: "ON_SITE", dayOffset: -1, driver: "sultan", sim: D("DONE", { withPhoto: true }) },
  { ref: "520a", type: "Доставка в аренду", title: "Доставка 2 шт. Тапко 2,2 м + 1 нож",
    contactPhone: "+79771680424", address: "Москва, Выхино-Жулебино, 138-й квартал Выхина", dayOffset: -1,
    driver: "sultan", sim: D("DONE", { withPhoto: true, withAct: true }) },
  { ref: "520b", type: "Выездной ремонт / диагностика", title: "Ремонт/настройка 4 шт. ЛБМ с ножами (взять побольше запчастей)",
    orgName: "ООО УЮТ Квадратного метра", contactName: "Алексей", contactPhone: "+79163547790",
    address: "Москва, Люблинская ул., 72", timeFrom: "09:00", timeTo: "16:00", dayOffset: -1, driver: "kashirskiy",
    sim: D("DONE", { withPhoto: true, withAct: false, lateOnSite: true }) }, // опоздание + без акта
  { ref: "521", type: "Доставка в аренду", title: "Доставка в аренду ЛБМ 250 + нож + дог.маш, 0,55 мм",
    equipment: "ЛБМ 250 + нож + дог. маш", orgName: "АРСЕНАЛ ГРУПП ООО", contactName: "Олег",
    contactPhone: "89166184545", address: "Москва, Вешняковская ул., 12к3", dayOffset: -1, driver: "pisarev",
    sim: D("DONE", { withPhoto: true, withAct: true }) },

  // ── 17 июня (dayOffset 0): сегодня, в работе ──
  { ref: "501", type: "Доставка/возврат из ремонта", title: "Доставка ножа Ван Марк с ремонта",
    address: "Москва, Егорьевский проезд", timeNote: "не забываем", dayOffset: 0, driver: "kashirskiy", sim: D("IN_PROGRESS") },
  { ref: "522", type: "Выездной ремонт / диагностика", title: "Ремонт/настройка ЛБМ 250 с ножом",
    orgName: "ЗАВОД ВИНРЭЙН ООО", contactName: "Иван", contactPhone: "89296585926",
    address: "МО, район Домодедово (точный адрес уточняется)", dayOffset: 0, driver: "kashirskiy", sim: D("ASSIGNED") },
  { ref: "523", type: "Выездной ремонт / диагностика", title: "Ремонт/настройка Профи с ножом",
    contactPhone: "+79603561551", address: "Москва, Михалковская ул., 13", paymentType: "OFFICE",
    dayOffset: 0, driver: "kashirskiy", sim: D("ASSIGNED") },
  { ref: "524a", type: "Выездной ремонт / диагностика", title: "Ремонт/настройка ЛБМ250, заточка роликов, замена деталей по мелочи",
    orgName: "ООО «СМС СК»", contactName: "Сергей (прораб)", contactPhone: "+79998329079",
    address: "Сергиев Посад, Центральная ул., 1, Завод «Звезда»", passStatus: "ORDERED", dayOffset: 0,
    driver: "kashirskiy", sim: D("ASSIGNED") },
  { ref: "524b", type: "Выездной ремонт / диагностика", title: "Диагностика станка + настройка ножа на месте (заказ №940)",
    equipment: "нож на прод маз, фальц машинка Sorex", orgName: "Икселерейт", contactName: "Николай",
    contactPhone: "+79951161412", address: "Москва, ул. Подольских Курсантов, 15Б, стр.7",
    addressLink: "https://yandex.ru/maps/org/ikselereyt/6416920072", timeFrom: "08:30", timeTo: "17:30",
    passStatus: "NEEDED", dayOffset: 0, driver: "kashirskiy", sim: D("ASSIGNED") },
  { ref: "525", type: "Выездной ремонт / диагностика", title: "Отвезти б/у нож Sorex в сборе + настройка на станок клиента (обмен ножами, заказ 1065)",
    contactName: "Воскан", contactPhone: "+79855150323", address: "Москва, Троицк, д. Яковлево, Лесная ул., 111к13",
    paymentType: "ON_SITE", paymentNote: "созвониться перед выездом обязательно", dayOffset: 0,
    driver: "kashirskiy", sim: D("ASSIGNED") },

  // ── 18–19 июня (dayOffset +1): назначены, ещё не начаты ──
  { ref: "526", type: "Доставка проданного", title: "Доставка нового Sorex 2 м + нож, забор трейд-ин Tapco Max 3,2 м",
    equipment: "Sorex 2 м + нож", invoiceNumber: "1060", contactName: "Хуршед", contactPhone: "+79650168776",
    address: "Москва, рынок Синдика", addressLink: "https://maps.app.goo.gl/82dcsAz19qodbcoEA",
    paymentType: "ON_SITE", paymentNote: "доплата на выгрузке", dayOffset: 1, driver: "pisarev", sim: D("ASSIGNED") },
  { ref: "527", type: "Выездной ремонт / диагностика", title: "Ремонт ЛБМ + Мазанек с ножом (взять запчасти, возможно капиталка)",
    contactName: "Роман", contactPhone: "+79038283836", address: "Ярославская обл., Переславский р-н, д. Короткого",
    paymentType: "OFFICE", dayOffset: 1, driver: "pisarev", sim: D("ASSIGNED") },
  { ref: "528", type: "Выездной ремонт / диагностика", title: "Ремонт/настройка Профи с ножом",
    contactName: "Тимур", contactPhone: "+79603561551", address: "Москва, Коптево, ул. Михалковская, 13А",
    paymentType: "OFFICE", dayOffset: 1, driver: "kashirskiy", sim: D("ASSIGNED") },
  { ref: "529", type: "Забрать СДЭК/посылку", title: "Забрать груз (Желдорэкспедиция)",
    invoiceNumber: "2252-1315-4018-8034", address: "Москва, ПВЗ Желдорэкспедиция (по накладной)",
    timeFrom: "13:30", paymentType: "ON_SITE", paymentAmount: 1812, timeNote: "126 кг / 0,52 м³, к выдаче с 13:30",
    dayOffset: 1, driver: "pisarev", sim: D("ASSIGNED") },
  { ref: "530", type: "Доставка в аренду", title: "Доставка ЛБМ 300 + нож + дог.маш, 0,7 мм",
    equipment: "ЛБМ 300 + нож + дог. маш", orgName: "БИЛДЭКО ООО", contactName: "Алексей",
    contactPhone: "+79047940386", address: "Москва, 8-я ул. Соколиной Горы, 26А", dayOffset: 1,
    driver: "sultan", sim: D("ASSIGNED") },
];

// ── Хелперы времени ──
function dayKey(offset: number): string {
  const d = new Date(`${BASE_DAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function dbDate(offset: number): Date {
  return new Date(`${dayKey(offset)}T00:00:00.000Z`);
}
// Момент в МСК (UTC+3) указанного дня: HH:MM МСК → UTC.
function at(offset: number, hhmmMsk: string): Date {
  const [h, m] = hhmmMsk.split(":").map(Number);
  const utcH = h - 3;
  return new Date(`${dayKey(offset)}T${String(utcH).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
}
function addMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

// Порядок цепочки статусов для построения истории (этап A: схлопнуто до IN_PROGRESS).
const FORWARD: TaskStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "DONE"];

async function cleanup(): Promise<void> {
  const titles = TASKS.map((t) => t.title);
  const existing = await prisma.task.findMany({
    where: { title: { in: titles } },
    select: { id: true, attachments: { select: { filePath: true } } },
  });
  if (existing.length === 0) return;
  const ids = existing.map((t) => t.id);
  await prisma.kpiMark.deleteMany({ where: { taskId: { in: ids } } });
  for (const t of existing) for (const a of t.attachments) await deleteUpload(a.filePath).catch(() => {});
  await prisma.attachment.deleteMany({ where: { taskId: { in: ids } } });
  await prisma.taskEvent.deleteMany({ where: { taskId: { in: ids } } });
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
  console.log(`  ✓ очищено прошлых имитационных задач: ${existing.length}`);
}

async function main(): Promise<void> {
  const milena = await prisma.user.findUnique({ where: { login: "milena" }, select: { id: true } });
  if (!milena) throw new Error("Пользователь milena не найден — сначала прогоните основной сид");
  const drivers = Object.fromEntries(
    (await prisma.user.findMany({ where: { role: "DRIVER" }, select: { id: true, login: true } })).map((u) => [u.login, u.id]),
  );
  const types = Object.fromEntries(
    (await prisma.taskType.findMany({ select: { id: true, name: true, requiresPhoto: true, requiresSignedDoc: true } })).map(
      (t) => [t.name, t],
    ),
  );

  await cleanup();

  let created = 0;
  for (const t of TASKS) {
    const type = types[t.type];
    if (!type) throw new Error(`Тип не найден: ${t.type}`);
    const driverId = drivers[t.driver];
    if (!driverId) throw new Error(`Водитель не найден: ${t.driver}`);

    const task = await prisma.task.create({
      data: {
        typeId: type.id,
        title: t.title,
        equipment: t.equipment ?? null,
        orgName: t.orgName ?? null,
        contactName: t.contactName ?? null,
        contactPhone: t.contactPhone ?? null,
        address: t.address,
        addressLink: t.addressLink ?? null,
        invoiceNumber: t.invoiceNumber ?? null,
        paymentType: t.paymentType ?? "NONE",
        paymentAmount: t.paymentAmount ?? null,
        paymentNote: t.paymentNote ?? null,
        scheduledDate: dbDate(t.dayOffset),
        timeFrom: t.timeFrom ?? null,
        timeTo: t.timeTo ?? null,
        timeNote: t.timeNote ?? null,
        passStatus: t.passStatus ?? "NOT_NEEDED",
        status: t.sim.status,
        assigneeId: driverId,
        createdById: milena.id,
        completedAt: t.sim.status === "DONE" ? at(t.dayOffset, "17:00") : null,
        holdReason: t.sim.status === "ON_HOLD" ? "Уточняем у офиса объём (капиталка?)" : null,
      },
    });

    // История событий: created (Милена) → assign → водительские статусы по цепочке.
    const events: { actorId: string; kind: string; fromStatus: TaskStatus | null; toStatus: TaskStatus | null; comment: string | null; at: Date; lat: number | null; lng: number | null }[] = [];
    events.push({ actorId: milena.id, kind: "created", fromStatus: null, toStatus: "NEW", comment: null, at: at(t.dayOffset, "08:00"), lat: null, lng: null });
    events.push({ actorId: milena.id, kind: "assign", fromStatus: "NEW", toStatus: "ASSIGNED", comment: null, at: at(t.dayOffset, "08:05"), lat: null, lng: null });

    const targetIdx = FORWARD.indexOf(t.sim.status);
    // Момент взятия в работу (IN_PROGRESS). При lateOnSite — позже окна времени (для нарушения «опоздание»).
    const startedAt = t.sim.lateOnSite && t.timeTo ? addMin(at(t.dayOffset, t.timeTo), 40) : at(t.dayOffset, t.timeFrom ?? "11:00");
    const stepTime: Partial<Record<TaskStatus, Date>> = {
      IN_PROGRESS: startedAt,
      DONE: addMin(startedAt, 40),
    };
    // водительские шаги вперёд (ASSIGNED уже создан выше)
    for (let i = 2; i <= targetIdx && t.sim.status !== "ON_HOLD"; i++) {
      const to = FORWARD[i];
      events.push({ actorId: driverId, kind: "status_change", fromStatus: FORWARD[i - 1], toStatus: to, comment: null, at: stepTime[to] ?? at(t.dayOffset, "12:00"), lat: 55.75, lng: 37.61 });
    }
    // зависшая задача: взята в работу и встала на паузу
    if (t.sim.status === "ON_HOLD") {
      events.push({ actorId: driverId, kind: "status_change", fromStatus: "ASSIGNED", toStatus: "IN_PROGRESS", comment: null, at: at(t.dayOffset, "09:00"), lat: 55.75, lng: 37.61 });
      events.push({ actorId: driverId, kind: "status_change", fromStatus: "IN_PROGRESS", toStatus: "ON_HOLD", comment: "Уточняем у офиса объём (капиталка?)", at: at(t.dayOffset, "10:30"), lat: 55.75, lng: 37.61 });
    }
    await prisma.taskEvent.createMany({ data: events.map((e) => ({ taskId: task.id, ...e })) });

    // Вложения: фото-отчёт и/или подписанный акт.
    if (t.sim.withPhoto && t.sim.status === "DONE") {
      const fp = await saveUpload(JPEG, "image/jpeg");
      await prisma.attachment.create({ data: { taskId: task.id, kind: "PHOTO", filePath: fp, mimeType: "image/jpeg", sizeBytes: JPEG.byteLength, createdById: driverId, lat: 55.75, lng: 37.61 } });
    }
    if (t.sim.withAct) {
      const fp = await saveUpload(PDF, "application/pdf");
      await prisma.attachment.create({ data: { taskId: task.id, kind: "DOCUMENT", filePath: fp, mimeType: "application/pdf", sizeBytes: PDF.byteLength, createdById: driverId } });
    }
    created++;
  }
  console.log(`  ✓ заведено имитационных задач: ${created}`);

  // Прогон детектора за прошедшие дни (15 и 16 июня); сегодня ещё в работе — не детектим.
  for (const off of [-2, -1]) {
    const asOf = at(off, "23:30");
    const r = await detectCandidatesForDate(asOf);
    console.log(`  ✓ детектор за ${dayKey(off)}: создано кандидатов ${r.created}`, r.byKind);
  }

  // Имитация решений Милены: подтверждаем все авто-кандидаты, кроме одного (оставим «на разбор»).
  const period = `${BASE_DAY.slice(0, 7)}`;
  const candidates = await prisma.kpiMark.findMany({ where: { period, status: "CANDIDATE", kind: { not: "MANUAL" } }, orderBy: { occurredAt: "asc" } });
  const milenaActor = { id: milena.id, role: "DISPATCHER" };
  for (const c of candidates.slice(0, -1)) await resolveMark(c.id, "CONFIRMED", milenaActor);
  console.log(`  ✓ Милена подтвердила ${Math.max(0, candidates.length - 1)} из ${candidates.length} кандидатов (1 оставлен на разбор)`);

  // Имитация ручного поощрения за аккуратную работу.
  const pisarev = drivers["pisarev"];
  if (pisarev) {
    await addManualMark({ driverId: pisarev, amount: 3000, note: "Поощрение: аккуратная сдача аренды без замечаний", period }, milenaActor);
    console.log("  ✓ ручное поощрение Писареву +3000 ₽");
  }

  // Сводка расчёта.
  const overview = await getKpiOverview(period);
  console.log(`\n=== KPI за ${period} (кандидатов на разбор: ${overview.candidates.length}) ===`);
  for (const d of overview.drivers) {
    console.log(
      `  ${d.driverName}: оклад ${d.baseSalary} + премия ${d.premiumBase} − штраф ${d.penalty} + поощр ${d.bonus} = ИТОГ ${d.total} (нарушений: ${d.marks.length})`,
    );
  }
}

main()
  .then(() => console.log("\nИмитация пилота готова."))
  .catch((e) => {
    console.error("Имитация упала:", e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

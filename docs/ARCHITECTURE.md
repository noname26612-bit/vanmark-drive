# ARCHITECTURE — vanmark-drive

Версия 1.0 · июнь 2026. Решения зафиксированы с Артёмом: монолит Next.js, PostgreSQL, PWA для водителей (Android). Сервис полностью автономен; интеграция с 1С отложена (наработки — в `docs/archive/`).

## 1. Принципы

1. Один монолит, один деплой, один язык (TypeScript). Никаких микросервисов и лишних движущихся частей — проект ведёт один человек.
2. Безопасность изоляции задач — на сервере, всегда. Фронт ничего не «скрывает», сервер не отдаёт чужое.
3. Простое масштабирование удалением: SSE/Centrifugo/S3/карты добавляем только когда упрёмся, в MVP — поллинг, локальные файлы, deeplink в навигатор.
4. Все доменные правила (статусная матрица, права) — в одном модуле `src/domain/`, не размазаны по обработчикам.

## 2. Стек

| Слой | Выбор | Примечание |
|---|---|---|
| Фреймворк | Next.js (App Router) + React, TypeScript strict | один проект: доска + PWA + API |
| БД | PostgreSQL 16+ | в Docker рядом с приложением |
| ORM | Prisma + миграции | схема ниже — источник правды |
| Auth | Auth.js (NextAuth v5), Credentials provider | логин+пароль, JWT-cookie, роли в БД |
| UI | Tailwind CSS + минимальный собственный набор контролов в `src/components/ui` | статус-цвета из UI-гайдлайна (skill ui-guidelines). shadcn/ui отложен (трения init с Tailwind v4 в этой среде); набор примитивов держим единым, при необходимости перейдём на shadcn |
| Данные на клиенте | SWR (поллинг 10 с) | этап 6 — SSE, если поллинга не хватит |
| PWA | Web App Manifest + рукописный service worker `public/sw.js` (push + офлайн-кэш оболочки) | водители — Android/Chrome. Офлайн-режим (§11): данные и очередь действий — IndexedDB на уровне приложения; холодный старт — рукописный Cache API в `sw.js` (cache-first статика, network-first навигация, guard на localhost). Serwist НЕ используем: на Next 16 требует webpack-сборки и `tsconfig lib=webworker` (ломает типы React-проекта) — рукописный кэш проще и не трогает сборку |
| Push | Web Push API + библиотека web-push 3.6 (VAPID) | подписки в БД (`PushSubscription`); протухшие (404/410) чистятся |
| Фото | локальный volume + раздача через route handler с проверкой прав | S3-совместимое хранилище — фаза 3 |
| Деплой | Docker Compose: app + postgres + Caddy (авто-HTTPS) | VPS в РФ (Timeweb Cloud / Selectel) |
| Тесты | Vitest (unit/домен) + Playwright (e2e) | обязательные тесты изоляции |

При инициализации проекта Claude Code обязан проверить актуальные стабильные версии (Next.js, Prisma, Auth.js, Serwist, Tailwind) и зафиксировать их в package.json — не брать версии из этого документа на веру.

## 3. Структура проекта

```
src/
  app/
    (dispatcher)/board/...      # доска Милены: «Водители», «Все задачи», карточка
    (driver)/m/...              # PWA водителя: «Мои задачи», карточка, завершение
    (machines)/machines/...     # модуль «Станки» (§4г): сводка, список, карточка — С/Д/А, адаптив
    (dispatcher)/team/...       # вкладка «Команда» (§4д): дни рождения и отпуска коллектива — Д/А/С
    api/                        # route handlers (REST)
    login/
  domain/                       # ЯДРО: статусная матрица, права, доменные сервисы
    task-status.ts              # допустимые переходы + кто может
    authz.ts                    # canView / canTransition / assertOwnership
    task-service.ts             # создание, назначение, смена статуса (+события, +пуши)
    notifications.ts            # чистые билдеры пушей + валидация подписки (юнит-тесты)
    push-service.ts             # подписки (save/delete) + плановые напоминания (cron)
    kpi.ts                      # KPI (Фаза 1.5): детекторы нарушений + прогрессивный расчёт (чистые функции, юнит-тесты)
    kpi-service.ts              # KPI: кандидаты, подтверждение/отклонение, ручные отметки, закрытие месяца, расчёт водителя (с изоляцией)
    capacity.ts                 # Ёмкость (Фаза 2): haversine, время в пути с коэффициентами, оценка задачи (чистые функции, юнит-тесты)
    capacity-service.ts         # Ёмкость: агрегация загрузки по водителям×дням для календаря (изоляция Д/А)
    machine-access.ts           # Станки (§4г): кто имеет доступ к модулю (белый список ролей)
    machine-status.ts           # Станки: совместимость категория×состояние, архивные состояния (чистые функции)
    machine-flags.ts            # Станки: индикаторы сводки — рабочие дни диагностики, давность сверки (чистые функции)
    machine-service.ts          # Станки: картотека, журнал «было→стало», счётчики сводки
    machine-attachment-service.ts # Станки: фото (тот же том и та же раздача через handler, что у задач)
    birthdays.ts                # Команда (§4д): ближайший день рождения — 29.02 и переход через Новый год (чистые функции, юнит-тесты)
    team-service.ts             # Команда: снимок справочника коллектива, сотрудники без доступа, мягкая деактивация
    absence-service.ts          # Отпуска/больничные: реестр на всех внутренних сотрудников (18.08.2026), источник для календаря и KPI
  lib/                          # prisma client, auth, утилиты
    push.ts                     # транспорт web-push (server-only): отправка + чистка протухших подписок
    cron.ts                     # планировщик node-cron (08:00 / 09:00 / 16:00 / 20:05 / 21:00 / 23:30 / 04:00)
    geocode.ts                  # геокодер адреса (server-only, внешний сервис, кэш по адресу) — Фаза 2, §4б
    search-core.ts              # движок умного поиска: разбор запроса, матчинг, подсветка (общий для задач и станков)
    task-search.ts              # предметный поиск по задачам поверх search-core
    machine-search.ts           # предметный поиск по станкам поверх search-core
  components/                   # ui-компоненты (+ sw-register, pwa-controls — этап 5)
  hooks/                        # use-push-subscription, use-install-prompt (этап 5)
  instrumentation.ts            # register(): старт node-cron в Node-рантайме
  app/manifest.ts               # Web App Manifest (/manifest.webmanifest)
prisma/schema.prisma
public/sw.js                    # рукописный service worker (push + notificationclick)
docker-compose.yml / Caddyfile
.claude/skills/                 # скиллы агента (см. папку skills)
CLAUDE.md
```

Правило: route handlers — тонкие (распаковка запроса → вызов domain-сервиса → ответ). Вся логика и проверки прав — в `src/domain/`.

## 4. Модель данных (Prisma)

```prisma
// SERVICE_MANAGER (05.08.2026) — менеджер-сервисник: ТОЛЬКО модуль станков (§4г), задач не видит.
// EMPLOYEE (18.08.2026) — сотрудник БЕЗ доступа в систему (§4д): карточка в справочнике коллектива.
// Роль не входит НИ В ОДИН белый список прав и не открывает ничего; войти под ней нельзя (§6).
enum Role        { ADMIN DISPATCHER DRIVER SERVICE_MANAGER EMPLOYEE }
// Переработка механики водителя: рабочая цепочка схлопнута в IN_PROGRESS «В работе».
// ACCEPTED/EN_ROUTE/ON_SITE — LEGACY (новым задачам не присваиваются, остаются ради истории TaskEvent).
enum TaskStatus  { NEW ASSIGNED IN_PROGRESS DONE ON_HOLD RESCHEDULED CANCELLED  /* legacy: */ ACCEPTED EN_ROUTE ON_SITE }
enum ShiftStatus { REQUESTED OPEN CLOSED }   // смена водителя: открыта → подтверждена → закрыта
enum PassStatus  { NOT_NEEDED NEEDED ORDERED }
enum TaskKind    { DELIVERY STAFF }   // контур: заявки водителям / задачи сотрудникам (PRD §17)
enum PaymentType { NONE OFFICE ON_SITE }
enum AttachmentKind { PHOTO DOCUMENT }
enum WorksheetStatus { DRAFT PRICING PRICED SIGNED }   // ведомость работ (этап 12, PRD §13.4)

model User {
  id            String   @id @default(uuid())
  login         String   @unique
  passwordHash  String
  name          String                 // «Милена», «Алексей Писарев»
  phone         String?
  birthday      DateTime? @db.Date     // день рождения (18.08.2026, §4д): год храним, показываем БЕЗ года
  role          Role
  isActive      Boolean  @default(true)
  canLogin      Boolean  @default(true)   // false — вход запрещён; включает админ («Водители — доступ»)
  isExternal    Boolean  @default(false)  // наёмный перевозчик (02.07): без смен (SHIFT_REQUIRED не применяется), вне KPI, carrierCost в заявке
  tasks         Task[]   @relation("assignee")
  createdTasks  Task[]   @relation("creator")
  events        TaskEvent[]
  pushSubs      PushSubscription[]
  uiPrefs       UiPreference[]            // персональная раскладка экранов диспетчера (порядок/свёрнутость пулов)
  createdAt     DateTime @default(now())
}

// Персональные настройки интерфейса (раскладка доски/планирования). value — JSON-массив строк-ключей
// пулов. Привязка к пользователю — раскладка одинакова на любом устройстве. Личность — только из сессии.
model UiPreference {
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  key       String                        // "board.order" | "board.collapsed" | "planning.order"
  value     Json                          // string[]
  updatedAt DateTime @updatedAt
  @@id([userId, key])
}

model TaskType {
  id            String  @id @default(uuid())
  name             String  @unique       // «Доставка в аренду», «Забор в ремонт»...
  icon             String?                // имя иконки lucide
  requiresPhoto    Boolean @default(true) // DEPRECATED (этап 11): фото больше не гейт — везде по желанию
  requiresSignedDoc Boolean @default(false) // дефолт «нужен акт» для новых задач (этап 11: фактический флаг переехал на Task)
  requiresPricing  Boolean @default(false) // нужна ведомость работ + расценка (этап 12): выездной ремонт, гарантия
  sortOrder        Int     @default(0)
  isActive         Boolean @default(true)
  tasks            Task[]
}

model Task {
  id            String     @id @default(uuid())
  number        Int        @unique        // сквозной, sequence (старт задаёт сид)
  // Номер задачи цеха «Ц-N» (16.08.2026, PRD §17): своя нумерация с 1, у доставок пусто. Значение
  // выдаёт домен из staff_task_number_seq (default на колонке жёг бы номера и на доставках).
  staffNumber   Int?       @unique
  typeId        String
  type          TaskType   @relation(fields: [typeId], references: [id])
  // Контур (15.08.2026, PRD §17): DELIVERY — заявки водителям, STAFF — задачи сотрудникам (цех и
  // снабжение). Снимок с типа на момент создания: тип могут переименовать, а раскладка экранов по
  // контурам меняться не должна. Экраны доставок фильтруют kind=DELIVERY, телефон — оба вместе.
  kind          TaskKind   @default(DELIVERY)
  requiresSignedDoc Boolean @default(false) // требование акта НА ЗАДАЧЕ (этап 11): снимок из типа, диспетчер снимает галочкой
  actWaivedNote String?                    // причина снятия акта на заявке (этап 11)
  worksheetStatus WorksheetStatus?         // ведомость работ (этап 12): null — не нужна для типа
  title         String                    // «ЛБМ 200 + нож + дог. маш, 0,7 мм»
  description   String?    @db.Text
  equipment     String?                   // «ЛБМ 250», «Sorex 2 м»
  orgName       String?                   // «ДОМОСТРОЙ ЛОГИСТИК ООО»
  contactName   String?
  contactPhone  String?
  address       String
  addressLink   String?                   // deeplink Яндекс/2ГИС
  invoiceNumber String?                   // «948», «261»
  paymentType   PaymentType @default(NONE) // через офис / на месте
  paymentAmount Int?                       // «доставка 5000 водителю»
  paymentNote   String?
  scheduledDate DateTime?  @db.Date        // null — пул «Без даты» («следующая неделя»)
  timeFrom      String?                   // «09:00»
  timeTo        String?                   // «17:00»
  timeNote      String?                   // «после обеда»
  passStatus    PassStatus @default(NOT_NEEDED)
  priority      Boolean    @default(false) // срочная
  status        TaskStatus @default(NEW)
  assigneeId    String?
  assignee      User?      @relation("assignee", fields: [assigneeId], references: [id])
  coDriverId    String?    // напарник парного выезда (20.07.2026, PRD §4): только при ответственном, != ему
  coDriver      User?      @relation("coDriver", fields: [coDriverId], references: [id])
  createdById   String
  createdBy     User       @relation("creator", fields: [createdById], references: [id])
  cancelReason  String?
  holdReason    String?
  events        TaskEvent[]
  attachments   Attachment[]
  workItems     WorkItem[]                 // позиции ведомости работ (этап 12)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  completedAt   DateTime?

  @@index([assigneeId, scheduledDate])
  @@index([coDriverId, scheduledDate])
  @@index([status, scheduledDate])
}

model TaskEvent {            // неизменяемый журнал — НИКОГДА не редактируется и не удаляется
  id         String      @id @default(uuid())
  taskId     String
  task       Task        @relation(fields: [taskId], references: [id])
  actorId    String
  actor      User        @relation(fields: [actorId], references: [id])
  kind       String      // status_change | comment | edit | assign | photo_added
  fromStatus TaskStatus?
  toStatus   TaskStatus?
  comment    String?
  lat        Float?
  lng        Float?
  at         DateTime    @default(now())

  @@index([taskId, at])
}

model Attachment {
  id          String         @id @default(uuid())
  taskId      String
  task        Task           @relation(fields: [taskId], references: [id])
  kind        AttachmentKind @default(PHOTO)
  filePath    String         // относительный путь в /data/uploads; вложения диспетчера при постановке
                             // и фото исполнителя различаются по createdById (отчётные — от исполнителя)
  mimeType    String
  sizeBytes   Int
  createdById String
  lat         Float?
  lng         Float?
  createdAt   DateTime       @default(now())
}

// Ведомость работ (этап 12, PRD §13). Водитель фиксирует работы без цен — цену ставит диспетчер (этап 13).
model WorkCategory {                         // раздел справочника (группа услуг/товаров), наполняет админ
  id        String            @id @default(uuid())
  name      String            @unique
  sortOrder Int               @default(0)
  isActive  Boolean           @default(true)
  items     WorkCatalogItem[]
}

model WorkCatalogItem {                     // справочник работ (наполняет админ)
  id           String        @id @default(uuid())
  name         String        @unique
  defaultPrice Int?                          // подсказка цены за единицу, ₽ (этап 13); водителю НЕ отдаётся
  categoryId   String?                       // раздел справочника (группа); null — без раздела
  category     WorkCategory? @relation(fields: [categoryId], references: [id])
  isActive     Boolean       @default(true)
  sortOrder    Int           @default(0)
  workItems    WorkItem[]
}

model WorkItem {                            // позиция ведомости: работа + количество (цена — этап 13)
  id            String           @id @default(uuid())
  taskId        String
  task          Task             @relation(fields: [taskId], references: [id])
  catalogItemId String?                     // null — свободная строка (работы нет в справочнике)
  catalogItem   WorkCatalogItem? @relation(fields: [catalogItemId], references: [id])
  name          String                      // снимок названия работы
  quantity      Int              @default(1)
  price         Int?                         // цена за единицу, ₽ (этап 13): null пока диспетчер не расценил
  sortOrder     Int              @default(0)
  createdById   String                      // водитель, заполнивший позицию
  createdAt     DateTime         @default(now())
}

model PushSubscription {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
}
```

Номер задачи: PostgreSQL sequence; стартовое значение задаётся в сиде (последний номер из Telegram-чата + 1 — уточнить у Артёма при запуске).

**Две нумерации по контурам (16.08.2026).** Заявка водителю живёт под сквозным `number` («№615»), задача цеха — под своим `staffNumber` («Ц-5»), из отдельной последовательности `staff_task_number_seq` (`START 1`, без `DEFAULT` и без `OWNED BY`: номер выдаёт домен только контуру STAFF, `nextStaffNumber` внутри транзакции создания). Отображение — единственная правда в `src/lib/task-number.ts` (`taskNumberLabel`, варианты написания и разбор запроса для поиска, по образцу `machine-number.ts`); собирать строку номера руками нельзя. Серверный поиск понимает «Ц-5»/«ц5»/«c5»/«5» (`parseStaffNumberQuery`). Миграция перенумеровала уже заведённые задачи цеха по дате создания (решение Артёма) и сдвинула последовательность за максимум.

## 4в. Смена водителя (переработка механики, Фаза 2)

Аддитивная миграция. Модель `Shift` (одна на водителя в день, `@@unique([driverId, date])`): `driverId`, `date` (@db.Date — локальный день), `status` (`ShiftStatus` REQUESTED→OPEN→CLOSED), `openedAt` (фактическое начало = момент нажатия водителя), `confirmedById`/`confirmedAt` (диспетчер подтвердил приход), `closedAt`. Изоляция (§6): водитель читает/меняет только свою смену (`driverId` из сессии); подтверждение, закрытие за водителя, список и правка смен — диспетчер/админ.

Закрытие и правка Д/А (№2/№3, 03.07.2026, аддитивная миграция `shift_close_audit`): смену водителя может закрыть и диспетчер/директор/админ (`closedById` — кто закрыл; null — сам водитель), по умолчанию временем «сейчас» либо вручную. Время закрытия правится задним числом (`closedAtReported` — снимок исходного, `closedAtAdjustedById`/`closedAtAdjustedAt`/`closedAtAdjustNote` — аудит; зеркало полей `openedAt*`). Правки времени — с обязательной причиной и запретом в закрытом расчётном месяце (закрытие влияет на «отработано/простой» и деньги в Сводке); `closedAt` держит АКТУАЛЬНОЕ время, учёт простоя считается по нему на лету.

Учёт времени (этап D): отработано = Σ длительностей задач «В работе → Завершено», простой = длина закрытых смен − отработано — считается в `summary-service` и показывается в «Сводке»/CSV. KPI-изменения — см. §4а. История смен за период с правкой времени открытия/закрытия — раздел «История смен» в «Сводке» (№3).

## 4а. Модель данных KPI и зарплаты (Фаза 1.5)

Добавляется аддитивной миграцией поверх §4 (никаких изменений существующих таблиц, кроме нового поля `TaskType.requiresSignedDoc`). Принципы PRD §12: KPI = нарушения, расчёт = оклад + (премия − прогрессивные штрафы) + поощрения, закрытый месяц неизменен.

```prisma
enum KpiMarkKind   { SHIFT_LATE UNSIGNED_DOCS MISSED_STOP MANUAL  /* legacy: */ LATE } // этап D: SHIFT_LATE заменил LATE
// Этап D: KpiMark += shiftId (+ @@unique([shiftId, kind]) — идемпотентность детектора смены);
// CapacitySettings += shiftStartMinutes(540)/shiftLateGraceMinutes(15) — порог «поздно открыл смену».
enum KpiMarkStatus { CANDIDATE CONFIRMED DISMISSED }         // предложено системой → решение Милены
enum PayoutFloor   { SALARY ZERO }                           // нижний порог итога (Артём 17.06.2026: SALARY)

// Отметка KPI. Авто-кандидаты создаёт детектор (cron), решение принимает диспетчер.
// Корректируемый реестр (не «журнал только на запись», как TaskEvent): пока месяц открыт,
// статус можно менять — каждое решение пишет resolvedById/resolvedAt. Закрытый месяц фиксируется
// снимком в PayrollStatement и больше не зависит от правок отметок.
model KpiMark {
  id           String        @id @default(uuid())
  driverId     String                                  // чей KPI; изоляция водителя — по нему
  driver       User          @relation("kpiDriver", fields: [driverId], references: [id])
  taskId       String?                                 // привязка к задаче (LATE/UNSIGNED_DOCS/MISSED_STOP); null — ручная общая
  task         Task?         @relation(fields: [taskId], references: [id])
  period       String                                  // месяц начисления «YYYY-MM» (по occurredAt)
  kind         KpiMarkKind
  status       KpiMarkStatus @default(CANDIDATE)
  occurredAt   DateTime                                // когда произошло — для прогрессии (порядок ошибок)
  note         String?                                 // автоописание / пояснение Милены
  manualAmount Int?                                    // только MANUAL: знаковая сумма ₽ (− штраф, + поощрение)
  createdById  String?                                 // null — авто-кандидат от системы; иначе диспетчер (ручная)
  createdBy    User?         @relation("kpiCreatedBy", fields: [createdById], references: [id])
  resolvedById String?                                 // кто подтвердил/отклонил
  resolvedAt   DateTime?
  createdAt    DateTime      @default(now())

  @@unique([taskId, kind])                             // идемпотентность детектора: одна авто-отметка вида на задачу
  @@index([driverId, period])
  @@index([status, period])
}

// Денежный профиль водителя (правила задаёт админ). Веса штрафов — глобальные (KpiRule).
model DriverPayProfile {
  id          String   @id @default(uuid())
  driverId    String   @unique
  driver      User     @relation("payProfile", fields: [driverId], references: [id])
  baseSalary  Int      @default(0)   // оклад ₽/мес
  premiumBase Int      @default(0)   // премия ₽ при нуле ошибок (полная «прибавка»)
  isActive    Boolean  @default(true)
  updatedAt   DateTime @updatedAt
}

// Глобальный вес штрафа по виду нарушения (3 строки). Настраивает админ в UI.
model KpiRule {
  id       String      @id @default(uuid())
  kind     KpiMarkKind @unique
  weight   Int                         // базовый штраф ₽ за ошибку этого вида
  isActive Boolean     @default(true)
}

// Глобальные настройки расчёта (singleton). Уточнение к v1 (17.06.2026): шаг прогрессии вынесен из
// константы в БД, т.к. админ настраивает прогрессию и порог в UI (PRD §8 экран 5). Чистая арифметика —
// по-прежнему в src/domain/kpi.ts, но параметры берутся отсюда.
model KpiSettings {
  id                    String      @id @default("singleton") // ровно одна строка
  progressionPercent    Int         @default(110)  // шаг прогрессии, % (110 = ×1.10)
  progressionStartIndex Int         @default(3)    // с какого по счёту нарушения месяца включается прогрессия
  floor                 PayoutFloor @default(SALARY) // нижний порог итога
  actBonusAmount           Int      @default(5000) // бонус за комплектность актов, ₽ (этап 15, §12.6)
  actBonusThresholdPercent Int      @default(80)   // порог комплектности актов для бонуса, %
  monthNormHours           Int      @default(176)  // нормо-часы месяца: цена часа = оклад/норма (Сводка v2, только админ)
  updatedAt             DateTime    @updatedAt
}

// Снимок расчёта за закрытый месяц (неизменяем). До закрытия расчёт считается на лету из KpiMark + правил.
model PayrollStatement {
  id          String   @id @default(uuid())
  driverId    String
  driver      User     @relation("payStatements", fields: [driverId], references: [id])
  period      String                       // «YYYY-MM»
  baseSalary  Int                          // снимок оклада
  premiumBase Int                          // снимок премии
  penalty     Int                          // сумма штрафов (положительное число)
  bonus       Int                          // сумма ручных поощрений
  actBonus    Int      @default(0)         // бонус за комплектность актов (этап 15, §12.6): 0 или actBonusAmount
  actBase     Int      @default(0)         // знаменатель: завершённые актовые задачи месяца (снимок)
  actComplete Int      @default(0)         // числитель: из них с приложенным актом (снимок)
  total       Int                          // итог к выплате (не ниже 0; включает actBonus)
  breakdown   Json                         // детализация по отметкам на момент закрытия
  closedById  String
  closedAt    DateTime @default(now())

  @@unique([driverId, period])
}
```

На стороне `User` добавляются обратные связи (`kpiMarks`, `payProfile`, `payStatements`), на `Task` — `kpiMarks`. Детекторы (см. §8) идемпотентны через `@@unique([taskId, kind])`; повторный прогон не плодит дубли.

## 4б. Модель данных: ёмкость задачи и календарь загрузки (Фаза 2)

Спека — PRD §14, решения Артёма 19.06.2026. Аддитивная миграция поверх §4 (существующие таблицы только дополняются полями). Геокодер — **первая внешняя интеграция** проекта; это осознанное отступление от принципа §1.3 («карты добавляем, когда упрёмся»): без координат точки нельзя оценить дорогу. Зависимость минимальная — один вызов при создании/правке адреса, с кэшем и мягким откатом (нет координат → оценка считается без дороги). Маршрутизатор с живыми пробками НЕ подключаем (PRD §14.6).

Дополнения существующих моделей:

```prisma
enum DriverSpecialization { REPAIR DELIVERY ANY }   // подсказка «кто свободен» (PRD §14.5)

// User     += specialization DriverSpecialization @default(ANY)  // Каширский REPAIR, Писарев/Султан DELIVERY
// TaskType += onSiteMinutes  Int @default(30)        // норма работы на объекте, мин (PRD §14.2)
// Task     += lat Float?                              // геокод адреса (один раз при создании/правке)
//          += lng Float?
//          += estimatedMinutes  Int?                  // оценка времени задачи (снимок; null — не посчитана)
// Task    += archivedAt   DateTime?                     // архив заявки (11.08.2026): мягкое удаление дубля
//          += archivedById String?                      // кто убрал (uuid без навигации, как принято)
//          += estimateIsManual  Boolean @default(false) // диспетчер задал вручную → не пересчитывать
```

Новые модели:

```prisma
// Глобальные настройки расчёта ёмкости (singleton, как KpiSettings). Дефолты — данные Артёма 19.06.2026.
model CapacitySettings {
  id              String   @id @default("singleton")
  baseLat         Float    @default(55.959611)   // база: пос. Лесные Поляны, ул. Ленина 1Ас26
  baseLng         Float    @default(37.864076)
  workdayMinutes  Int      @default(480)         // рабочий день минус обед (9–18 − 1 ч) = знаменатель загрузки
  avgSpeedKmh     Int      @default(50)          // свободная дорога; калибруется по факту (на подтверждение)
  detourPercent   Int      @default(110)         // коэфф. петляния (110 = ×1.1)
  countReturnTrip Boolean  @default(false)       // учитывать обратную дорогу (база→точка→база)
  updatedAt       DateTime @updatedAt
}

// Коэффициенты пробок по времени суток (PRD §14.3). Набор строк-правил, как KpiRule. Настраивает админ.
model TrafficWindow {
  id            String @id @default(uuid())
  fromMinutes   Int                              // минуты от полуночи: 04:00 = 240
  toMinutes     Int                              // 07:00 = 420 (окна не пересекаются, покрывают сутки)
  factorPercent Int                              // 100 = ×1.0 … 140 = ×1.4
  sortOrder     Int    @default(0)
}
```

Расчёт (чистые функции в `src/domain/capacity.ts`, юнит-тесты):
```
straightKm = haversine(base, point)
roadKm     = straightKm × detourPercent/100   (× 2, если countReturnTrip)
travelMin  = roadKm / avgSpeedKmh × 60 × trafficFactor(timeFrom)/100
estimate   = type.onSiteMinutes + travelMin     (round)
```
`trafficFactor` берёт `factorPercent` окна `TrafficWindow`, в которое попадает `timeFrom` (нет времени → дневное окно). Оценка пишется в `Task.estimatedMinutes` при создании и при правке адреса/`scheduledDate`/`timeFrom`/типа в `task-service`, если `estimateIsManual=false`. Агрегация для календаря (`capacity-service.ts`): сумма `estimatedMinutes` по (`assigneeId`, `scheduledDate`) за период — дёшево, индекс `@@index([assigneeId, scheduledDate])` уже есть. «Ремонтность» задачи для подсказки §14.5 определяется по `type.requiresPricing` (выездной ремонт + гарантия); отдельное поле типа не вводим.

## 4г. Модель данных: модуль «Станки» (картотека, Фаза 2)

Спека — PRD §16, решения Артёма 05.08.2026. **Полностью аддитивно**: ни одна существующая таблица не меняется, кроме `enum Role` (+`SERVICE_MANAGER`) и обратных связей на `User`. Это осознанный образец **модульного расширения на нового сотрудника**: новый модуль = роль + вкладка + свои таблицы + свои права. Задачи, KPI, смены и деньги модуль не трогает вообще — пересечений в коде нет, кроме общих примитивов (сессия, вложения, ошибки).

```prisma
enum MachineCategory { CLIENT OUR_SALE OUR_RENTAL }              // чей станок: клиентский / наш на продажу / наш арендный
enum MachineStatus   { ACCEPTED NEEDS_REPAIR IN_REPAIR READY RENTED RELEASED SOLD VOIDED } // ACCEPTED выведен из оборота 20.08.2026, оставлен ради истории
enum EquipmentFamily { BENDER SEAMER }                           // раздел: Листогибы / Фальцепрокатники (15.08.2026)
enum EquipmentKind   { MACHINE ROLLER_KNIFE FALZ_MACHINE SEAMER UNCOILER INVERTER } // вид внутри раздела (FALZ_MACHINE — 20.08.2026)

// Карточка станка. number — сквозной системный № (Postgres sequence machine_number_seq), УБРАН из
// интерфейса 15.08.2026. Учётный номер, который пишут маркером на железе, ведётся двумя схемами по
// происхождению: ourNumber «77-N» у своего парка, clientNumber «К-N» у клиентского. Заполнено не
// больше одного поля; при смене категорий номер переезжает в схему новых категорий
// (src/domain/machine-number.ts + changeCategories). Схема ПЕЧАТАЕМОГО номера читается из
// заполненного поля, а не из категорий (20.08.2026): «клиентскость» перестала быть одним значением,
// а номерное поле само говорит, в какой схеме номер выдан. Дубль ловится @@unique и отдаётся
// человеческой ошибкой ввода.
model Machine {
  id             String          @id @default(uuid())
  number         Int             @unique @default(dbgenerated("nextval('machine_number_seq'::regclass)")) // УБРАН из интерфейса 15.08.2026
  ourNumber      Int?                                 // «77-N» у своего железа; уникален внутри family
  clientNumber   Int?                                 // «К-N» у клиентского железа; уникален внутри family
  family         EquipmentFamily @default(BENDER)     // раздел: он же область уникальности номера
  kind           EquipmentKind   @default(MACHINE)    // своих полей у видов нет — общих хватает (PRD §16.3)
  quantity       Int             @default(1)          // остаток на складе; >1 только у UNCOILER/INVERTER
  categories     MachineCategory[]                    // СПИСОК с 20.08.2026: наш станок бывает и на продажу, и арендным
  status         MachineStatus   @default(NEEDS_REPAIR) // «Принят» выведен из оборота 20.08.2026
  model          String                               // обязательное поле №2 (кроме категорий)
  configuration  String?                              // комплектация: галочки в форме, в БД одна строка
  metalThickness String?                              // «0,7 мм»
  price          Int?                                 // цена в рублях, целыми (20.08.2026)
  serialNumber   String?                              // ВЫВЕДЕНО ИЗ ИНТЕРФЕЙСА 20.08.2026 (данные оставлены)
  orgName        String?                              // ВЫВЕДЕНО ИЗ ИНТЕРФЕЙСА 20.08.2026
  contactName    String?
  contactPhone   String?                              // ВЫВЕДЕНО ИЗ ИНТЕРФЕЙСА 20.08.2026
  invoice1C      String?                              // № заказа 1С — ТЕКСТ, интеграции нет (архив)
  responsibleId  String?                              // ответственный менеджер (Милена/Максим/Михаил/Артём)
  deliveredBy    String?                              // кто привёз (свободный текст + подсказки)
  arrivedAt      DateTime?       @db.Date             // дата поступления
  dueDate        DateTime?       @db.Date             // срок готовности/выдачи — универсальный дедлайн (PRD §16.4)
  isUrgent       Boolean         @default(false)
  defectNotes    String?         @db.Text             // дефектовка
  location       String?                              // ВЫВЕДЕНО ИЗ ИНТЕРФЕЙСА 20.08.2026
  notes          String?         @db.Text
  voidReason     String?                              // причина аннулирования (обязательна при VOIDED)
  diagnosedAt    DateTime?                            // «Диагностика проведена»
  lastVerifiedAt DateTime?                            // «Подтверждён на месте» (сверка при обходе)
  createdById    String
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  events         MachineEvent[]
  attachments    MachineAttachment[]
  kitParts       MachineKitPart[] @relation("kitHead")
  kitOf          MachineKitPart[] @relation("kitPart")
  @@unique([family, ourNumber]) @@unique([family, clientNumber])
  @@index([family, status]) @@index([status]) @@index([updatedAt])   // индекс по одиночной категории снят вместе с колонкой 20.08.2026
}

// Скрытые подсказки моделей (20.08.2026). Пул подсказок = справочник-константа + реально введённые
// названия, поэтому временное имя из одной карточки предлагается всем и навсегда. Крестик в списке
// кладёт имя сюда. Данные карточек не меняются; заведение карточки с тем же именем снимает запись.
model MachineModelSuppression {
  id          String          @id @default(uuid())
  family      EquipmentFamily
  nameLower   String                                  // сравнение регистронезависимое
  createdById String
  createdAt   DateTime        @default(now())
  @@unique([family, nameLower])
}

// Комплектация (15.08.2026): что уезжает вместе с головным станком. Две механики в одной таблице,
// различаются видом part: уникальный экземпляр (нож) — ровно один комплект; складская позиция —
// много комплектов, суммарно не больше остатка. consumedAt закрывает связь при продаже, поэтому
// остаток не списывается дважды. Инварианты — в src/domain/machine-kit.ts (частичным индексом их
// не выразить: условие зависит от вида ДРУГОЙ строки).
model MachineKitPart {
  id         String    @id @default(uuid())
  headId     String                                   // листогиб или фальцепрокатник
  partId     String                                   // нож / размотчик / частотник
  qty        Int       @default(1)
  consumedAt DateTime?                                // остаток списан вместе с продажей головного
  createdAt  DateTime  @default(now())
  @@unique([headId, partId]) @@index([partId])
}

// Журнал станка — ТОЛЬКО НА ЗАПИСЬ (CLAUDE.md правило 3), как TaskEvent.
// changes — «было→стало» по ключевым полям правки: [{field,label,from,to}] (расследуемость «кто передвинул станок»).
model MachineEvent {
  id        String        @id @default(uuid())
  machineId String
  actorId   String
  kind      String                                    // created | status_change | edit | comment | shop_task | photo_added | photo_removed
  fromStatus MachineStatus?
  toStatus   MachineStatus?
  comment   String?
  changes   Json?                                     // diff ключевых полей при kind=edit
  at        DateTime      @default(now())
  @@index([machineId, at])
}

// Фото станка — та же механика, что у вложений задач: файл в UPLOADS_DIR под серверным uuid,
// раздача ТОЛЬКО через route handler с проверкой прав (не из public/).
model MachineAttachment {
  id          String   @id @default(uuid())
  machineId   String
  filePath    String                                  // относительный путь в UPLOADS_DIR (uuid.ext)
  mimeType    String
  sizeBytes   Int
  createdById String
  createdAt   DateTime @default(now())
  @@index([machineId, createdAt])
}
```

**Правила состояния** (`src/domain/machine-status.ts`, чистые функции + юнит-тесты):
- **Жёсткой матрицы переходов НЕТ** — осознанно (PRD §16.3). Статусная матрица задач (§5) не менялась ни на строку и модулем станков не используется.
- **Категории — список** (20.08.2026). Инварианты держит домен, а не БД (это правила предметной области, они меняются вместе с продуктом): набор непустой; `CLIENT` не совмещается с `OUR_*`; `OUR_SALE` + `OUR_RENTAL` совмещаются. Функции: `normalizeCategories`, `isValidCategorySet`, `isOurCategories`, `categoriesLabel`.
- Проверяется **совместимость категорий и состояния**: `RENTED` требует `OUR_RENTAL` в наборе, `SOLD` — `OUR_SALE`, `RELEASED` — `CLIENT`. Смена категорий валидируется тем же предикатом. `categoriesFollowingStatus` ДОБАВЛЯЕТ недостающую категорию своему железу, а не заменяет прежнюю: сдали в аренду то, что стояло на продажу, — станок теперь и продаётся, и сдаётся.
- **`ACCEPTED` выведен из оборота** (20.08.2026): `SELECTABLE_MACHINE_STATUSES` его не содержит, сервер отказывает при попытке выставить, новые карточки заводятся в `NEEDS_REPAIR`. Значение оставлено в enum ради `MachineEvent` (удаление значения enum в Postgres требует пересоздания типа со всеми зависимостями).
- **Архивные** (терминальные для списка, но обратимые): `RELEASED`, `SOLD`, `VOIDED`. `VOIDED` требует причину (`voidReason`) — лечение дублей инвентаризации в append-only картотеке, из счётчиков исключается. `RENTED` — **не архив** (аренда возвращается в цикл).
- Переспрос перед архивным состоянием — на клиенте; возврат из архива разрешён (та же карточка, история копится).
- **Optimistic-lock не делаем** — осознанно (пользователей три, конфликт правки практически невозможен; журнал «было→стало» позволяет разобрать любой спор постфактум).

**Индикаторы сводки** (чистые функции, без cron и пушей — считаются при открытии экрана): «срочные» (`isUrgent`), «горит срок» (`machineDueState`: `dueDate` в прошлом → overdue, сегодня…+`DUE_SOON_DAYS`=2 дня → soon; считается по МСК-дню и ТОЛЬКО в NEEDS_REPAIR/IN_REPAIR/READY — в RENTED и архиве срок нейтрален; функция принимает дату и как `Date`, и строкой `YYYY-MM-DD`, чтобы у клиента не завелось второй реализации порога), «ждут диагностики» (`diagnosedAt = null`) и «не подтверждены» (`lastVerifiedAt = null`).

Последние два переписаны 20.08.2026 вместе с баннером обязательных отметок в карточке. Раньше это были пороги «рабочий день без диагностики» и «неделя без сверки» — индикатор загорался сам по календарю, и это читалось как просрочка. Артём переформулировал: отметки — **обязательная операция**, которую делают один раз (при заведении и заново после возврата из аренды). Поэтому признак простой: отметки нет — горит. Ровно это же условие рисует баннер, и разойтись они не могут. Сброс отметок при выходе из `RENTED` делает `applyStatusChangeTx` (плюс запись в журнал). Индикаторы не горят у архивных, складских и **у станков в аренде** (они у клиента — осматривать некому).

Счётчик `byCategory` считает станок в КАЖДОЙ его категории, поэтому сумма по категориям может превышать `total`. Плюс счётчики по видам (`byKind`). При фильтре `flag=duePressing` список сортируется по `dueDate` asc.

**«Задание в цех»** (07.08.2026): текст собирается чистой функцией `buildShopTaskText` (`src/lib/machine-shop-task.ts`) — единственный источник и для живого предпросмотра в модалке, и для записи на сервере; событие `kind=shop_task` хранит полный текст в `comment` (≤2000, при переполнении — человеческая ошибка, не обрезка). `sendShopTask` одной транзакцией пишет событие и (по флагу) переводит станок в `IN_REPAIR` через общий с `changeStatus` хелпер. Копирование/шаринг — `src/lib/clipboard.ts` (navigator.clipboard + фолбэк textarea; navigator.share только на Android/https), вызывается синхронно в жесте клика (transient activation), запись события — после; отмена системного шита событие не пишет.

**Справочник моделей** (`src/domain/machine-models.ts`): базовый список 25 названий (PRD §16.8) + транслитерация кириллица↔латиница с диграфами (sch→ш, ck→к, x→кс…) — движок поиска умеет только раскладку, а «лбм» должно находить «Sorex LBM». Транслит живёт у справочника, НЕ в `search-core`: в поиске по живым карточкам он дал бы шумные ложные совпадения, а в подборе из 25 строк лишняя подсказка безвредна. Пул подсказок = базовые + `distinct model` из БД (отдаётся в `GET /api/machines/meta`), комбобокс — `model-combobox.tsx` (свободный ввод сохраняется).

**Черновик формы создания** (`src/lib/machine-draft.ts`): один тихий черновик в `localStorage` (`vanmark:machine-draft:v1`, ключ версионирован), сохраняется при закрытии модалки с непустой формой, восстанавливается при открытии (плашка + «Начать заново»), чистится при успешном создании и по явной «Отмене» с переспросом. Фото в черновик не входят (File не сериализуется).

**Нумерация:** `machine_number_seq` создаётся отдельным SQL в миграции (по образцу `task_number_seq`) и `START 1`. Важно (грабли проекта): `prisma migrate dev` без `--create-only` пересоздаёт таблицы и **дропает sequence** — миграции этого модуля пишутся `--create-only` (или SQL руками через `migrate diff` + вычитка) с применением `migrate deploy`; паразитный `DROP SEQUENCE` теперь грозит **обеим** последовательностям — `task_number_seq` и `machine_number_seq` (миграция 20260810 это подтвердила). Значение `Role.SERVICE_MANAGER` добавляется **отдельной миграцией** (`ALTER TYPE ... ADD VALUE`): Postgres не позволяет использовать новое значение enum в той же транзакции, где оно создано; новые enum-типы целиком (`CREATE TYPE`, как `EquipmentKind`) этим не ограничены.

## 4д. Справочник коллектива: дни рождения и отпуска (18.08.2026)

Продукт — PRD §18. Аддитивно и почти без новых таблиц: два поля/значения и переиспользование существующего реестра отсутствий. Миграции **раздельные** (те же грабли, что с `SERVICE_MANAGER`): `20260818090000_add_employee_role` — только `ALTER TYPE "Role" ADD VALUE 'EMPLOYEE'`, `20260818090100_user_birthday` — `ALTER TABLE "User" ADD COLUMN "birthday" DATE`.

- **`User.birthday`** (`DateTime? @db.Date`) — календарная дата, как `DriverAbsence.dateFrom/dateTo`: UTC-полночь, без часовых поясов и без «вчера в Москве». Опционально (у кого не спросили — null). Год хранится, но подпись собирается без года (`formatBirthdayLabel` → «21 августа»): решение Артёма, возраст коллеги не показываем.
- **Роль `EMPLOYEE`** — сотрудник без доступа. `homeForRole('EMPLOYEE') = '/login'` (`src/domain/roles.ts`) — не маршрут, а страховка `exhaustive switch`: попасть туда невозможно, потому что сессии у роли не бывает (§6). `roleLabel` → «Сотрудник».
- **Отпуска — существующая `DriverAbsence`, миграции нет.** В `createAbsence` валидация ослаблена с «роль = DRIVER» до «действующий внутренний сотрудник» (`isActive && !isExternal`). Модель и поле `driverId` намеренно НЕ переименованы: таблица живая, переименование дало бы миграцию ради косметики. Календарь загрузки (§4б) и KPI (§4а) читают те же записи, но выбирают их по водителям — отпуск Милены или цехового на расчёты не влияет. Добавлена `listAbsencesFrom(fromKey)`: незакрытые отсутствия без верхней границы (отпуска планируют на месяцы вперёд, окно календаря в две недели здесь не годится).
- **`src/domain/birthdays.ts`** — чистое ядро без prisma и без `server-only`, поэтому покрывается обычными юнит-тестами: `matchesBirthday`, `celebrationInYear`, `nextBirthdayDate`, `upcomingBirthdays`, `birthdaysOn`, `formatBirthdayLabel`, `daysBetween`. Два нетривиальных правила: 29 февраля в невисокосный год празднуется 28.02 (житейская договорённость; «1 марта» отодвинуло бы поздравление на следующий месяц), а ближайшая дата ищется **в текущем и следующем году** — иначе 29 декабря не увидело бы январских именинников.
- **`src/domain/team-service.ts`** — `getTeamSnapshot` (люди + незакрытые отсутствия + дни рождения на 60 дней + МСК-сегодня одним снимком экрана: клиент считает «идёт сейчас / запланирован» от той же даты, что и сервер), `createEmployee`, `updateTeamMember`, `deactivateEmployee` (мягко, `isActive=false` — на человеке висят отпуска, а история в проекте не переписывается). `login` и `passwordHash` не входят в `MEMBER_SELECT` — наружу не уходят никогда.

## 5. Статусная матрица (единственный источник — `src/domain/task-status.ts`)

| Из \ В | ASSIGNED | IN_PROGRESS | DONE | ON_HOLD | RESCHEDULED | CANCELLED |
|---|---|---|---|---|---|---|
| NEW | Д | — | — | — | Д | Д |
| ASSIGNED | — | В | — | — | Д | Д |
| IN_PROGRESS | — | — | В | Д, В* | Д | Д |
| ON_HOLD | Д | В | — | — | Д | Д |
| RESCHEDULED → автоматически ASSIGNED на новую дату | | | | | | |

Переработка механики водителя: рабочая цепочка схлопнута до **IN_PROGRESS «В работе»** (прежние ACCEPTED→EN_ROUTE→ON_SITE — одно состояние). До взятия (NEW/ASSIGNED) водитель статуса не ведёт. Цепочка водителя: ASSIGNED → IN_PROGRESS → DONE; пауза **ON_HOLD «На паузе»** освобождает «слот» и возвращается в работу через IN_PROGRESS. Legacy-статусы ACCEPTED/EN_ROUTE/ON_SITE рёбер не имеют (только история). Подписи статусов: IN_PROGRESS «В работе», DONE «Завершена», ON_HOLD «На паузе».

Д — диспетчер/админ; В — назначенный водитель; В* — водитель ставит «На паузе» (причину можно указать по желанию — решение Артёма 02.07.2026; ранее была обязательной). Отмена (CANCELLED) по-прежнему требует причину — источник истины `reasonRequiredFor` в `task-status.ts`. **Одна активная задача**: переход →IN_PROGRESS запрещён (ACTIVE_TASK_EXISTS, 409), если у исполнителя уже есть задача в IN_PROGRESS (проверка в `task-service`). Жёсткий запрет (Артём 20.07): занятость НАПАРНИКОМ в активной парной блокирует так же — водитель не берёт свою, пока парная «В работе» (назначенная, но не начатая парная — не блокирует); симметрично закрыты переназначение активной задачи на занятого водителя и добавление занятого напарником в активную задачу. **Требуется открытая смена**: водитель берёт свою задачу в работу только при открытой смене (REQUESTED/OPEN), иначе `SHIFT_REQUIRED` (409); диспетчер, ведущий за исполнителя, этим не ограничен. Фото при DONE по желанию; при `paymentType = ON_SITE` — подтверждение получения денег (сумма пишется в событие) — единственный серверный гейт завершения. Требуемый акт и опоздание — мягкие отметки KPI, не блокируют (PRD §5, §12). Любая корректировка статуса диспетчером задним числом — это новый event, история не переписывается.

Уточнено с Артёмом 04.06.2026 (реализовано в `src/domain/task-status.ts`): диспетчер/админ может выполнить ЛЮБОЙ валидный переход матрицы (включая «водительские» шаги вперёд) — это нужно, чтобы вести статусы за внешнего исполнителя (Султан, без приложения) и исправлять ошибки. Водитель — только разрешённые ему рёбра и только по своей задаче. Сами рёбра матрицы не меняются.

**Архив (11.08.2026): это НЕ статус.** Мягкое удаление живёт отдельными полями `Task.archivedAt/archivedById` и матрицу не трогает: заявка любого статуса может быть архивной, переходы при этом не меняются. Домен — `archiveTask`/`unarchiveTask` (`task-service.ts`), API — `PATCH /api/tasks/:id {op:"archive"|"unarchive"}`, право — `isTaskManagerRole`. Каждое действие пишет событие (`kind:"archive"|"unarchive"`), строка и журнал остаются, номер не переиспользуется. Гейт: завершённая заявка из закрытого месяца (`PayrollStatement` за период `completedAt`) не архивируется и не возвращается — `PERIOD_CLOSED`. Нерешённые `KpiMark` (`status=CANDIDATE`) по архивируемой заявке удаляются, решённые — нет. Исключение архивных — в КАЖДОЙ выборке задач: `listTasks` (кроме `scope=archive`), `myTasksWhere`, `attention`, `buildWorkloadCalendar`, `summary-service`, детекторы KPI, утренние пуши. Забыть один такой запрос = архивная заявка «выныривает» в отчёте.

**Отменённые вне рабочих экранов (11.08.2026).** `ListFilters.hideCancelled` → `status: { not: "CANCELLED" }`; параметр `hideCancelled=1` шлют доска, «Планирование» и окно дня календаря (ячейки календаря фильтровали и раньше — `capacity-service.ts`). У водителя отменённые убраны в `myTasksWhere` для обеих вкладок. Во «Все задачи» флага нет: там отмена ищется фильтром по статусу.

**Напарник (20.07.2026): матрица НЕ менялась.** Для матрицы и правила «одна активная задача» исполнитель — строго `assigneeId` (`authz.isAssignee`); напарник (`coDriverId`) переходы делать не может (для него `isAssignee=false` → FORBIDDEN), ведомость работ ему тоже закрыта (гейт в `work-service`: DRAFT-мутации — только `assigneeId`). При смене ответственного пара живёт по правилу `resolveCoDriverOnAssign` (`src/domain/co-driver.ts`): назначение на напарника — swap ролей; на третьего/снятие — напарник снимается; события `kind:"assist"` пишутся в журнал. Пуши изменений/переносов/отмен приходят обоим; при добавлении в пару напарнику уходит отдельный «Ты напарник по заявке №N» (в цехе — «по задаче Ц-N»). С 16.08.2026 пара работает в обоих контурах: кандидата проверяет `assertAssignableFor(kind)` (водитель в доставку, доступ `staffTasksAccess` в цех), а запрет «напарник занят другой активной» применяется только к доставкам — контуры параллельны. Занятость учитывается обоим (календарь загрузки, полоса «В работе/Простой» — union интервалов, сводка «в паре»); деньги/расценка/бонус за акты — только ответственному.

## 6. Авторизация и изоляция (критично)

- Сессия: Auth.js, JWT в httpOnly cookie. Личность и роль — ТОЛЬКО из сессии. Клиент никогда не передаёт `userId`/`assigneeId` от своего имени.
- Каждый handler начинается с `const user = await requireUser(req)`; для водительских маршрутов — `requireRole('DRIVER')`.
- Списки водителя: всегда владение из сессии — `OR: [{ assigneeId: user.id }, { coDriverId: user.id }]` (напарник видит парные задачи, 20.07.2026), обёрнутое в верхнеуровневый AND (`myTasksWhere`) — без исключений.
- Объект по id: `assertCanView(user, task)` — водителю чужая задача отдаёт **404** (не 403, чтобы не раскрывать существование). Видимость = ответственный ИЛИ напарник; право статусов (`isAssignee`) — строго ответственный.
- Мутации: `assertCanTransition(user, task, toStatus)` из домена — проверяет и владение, и допустимость перехода по матрице.
- Фото отдаются НЕ из публичной статики, а через `GET /api/attachments/[id]` с теми же проверками прав.
- Rate limit на `/api/auth/*` (брутфорс), пароли — argon2id.
- Обязательные e2e-тесты изоляции (см. skill security-check): водитель A не видит и не может изменить задачу водителя B ни одним эндпоинтом.
- KPI (Фаза 1.5): `GET /api/my/kpi` и расчёт водителя берут `driverId` ТОЛЬКО из сессии; чужой расчёт по прямой ссылке/ID — **404**. Подтверждение нарушений, ручные отметки, настройки оплаты и закрытие месяца — только диспетчер/админ (водитель эти ручки не видит). Каждый KPI-эндпоинт проходит security-check (та же дисциплина, что и задачи).
- **Права роли SERVICE_MANAGER: два белых списка (11.08.2026).** Роль перестала быть «только станки»: Артём открыл ей ЗАЯВКИ, оставив закрытыми смены, KPI/нарушения, пометки простоя, «Сводку», расценку и админку. Одного предиката для этого мало, поэтому права расщеплены:
  - `isTaskManagerRole` (`src/domain/task-access.ts`) = ADMIN | DISPATCHER | SERVICE_MANAGER — заявки: `canViewTask`, `createTask`/`updateTaskFields`/`assignTask`/`planTask`/`archiveTask`, свободная смена статуса в `checkTransition`, guard `requireTaskManager()` на `/api/tasks*`, `/api/board/attention`, `/api/capacity/calendar`, `GET /api/absences`.
  - `isDispatcherRole` (`task-status.ts`) = ADMIN | DISPATCHER — без изменений: `requireDispatcher()` на сменах, KPI, простое, сводке, расценке; `requireAdmin()` — админка.
  Разделение обязано быть видно и в интерфейсе: `DispatcherNav` фильтрует вкладки белым списком по роли (показать вкладку, ведущую на redirect, — баг), блок «Смены водителей» на доске скрыт флагом `canManageShifts` (роль в клиент не передаётся, как и с `payrollVisible`), у `/pricing` появился собственный guard — layout сюда пускает и менеджера-сервисника. Цены ведомости для него вырезаются на сервере (`stripWorkPrices`), а `carrierCost` остаётся: это поле заявки, а не аналитика.
  Попутно исправлены два места «от противного», которые при расширении роли отдали бы ей лишнее: `transitionTask` снимал деньги только с DRIVER (теперь белый список), `loadTaskForWorksheet` проверял владение только у DRIVER (теперь `canEditWorksheet`). `/api/work-catalog` переписан с отрицаний на перечисление ролей.

- **Роль SERVICE_MANAGER (05.08.2026, §4г).** Права роли — БЕЛЫЙ список, а не «всё кроме»: доступ к модулю станков дают три роли (`isMachineRole` = SERVICE_MANAGER | DISPATCHER | ADMIN, `src/domain/machine-access.ts`), всё остальное для новой роли закрыто по умолчанию. Ключевое требование при её вводе — **проверить существующие guard'ы на допущение «роль не DRIVER ⇒ штаб»**: `requireDispatcher` опирается на `isDispatcherRole` (белый список ADMIN|DISPATCHER — новая роль не проходит), `requireAdmin`/`requireDriver` — точное сравнение, страницы — `requireRole`/`requireAnyRole` с редиректом на `homeForRole`. Отдельно проверяются эндпоинты с одним лишь `requireApiUser()` (без роли): `canViewTask` для SERVICE_MANAGER возвращает false → чужая карточка/вложение отдают 404. Маршруты новой роли: `homeForRole('SERVICE_MANAGER') = '/machines'`; `exhaustive switch` в `src/domain/roles.ts` заставляет типизацию упасть, если роль забыли учесть.
  - **Персональный доступ (15.08.2026).** К белому списку ролей добавлен флаг `User.equipmentAccess` — единственное право в системе, выданное не ролью (Николай и Александр). Предикат один: `canAccessEquipment` = роль из списка ИЛИ флаг (`src/domain/machine-access.ts`); guard'ы `requireMachineUser()` (API) и `requireEquipmentUser()` (страницы) читают флаг ИЗ БД, а не из JWT, — выдача и отзыв действуют сразу, без перезахода. Флаг НИЧЕГО не открывает сверх оборудования: задачи, смены, KPI, сводка и админка закрыты своими белыми списками ролей, и это зафиксировано e2e (`machines-access.spec.ts`, describe «Персональный доступ к оборудованию»).
  - **Второй персональный флаг — `User.staffTasksAccess` (15.08.2026, вечер).** Устроен так же: решает, кому можно ставить задачи сотрудникам (цех и снабжение) и кто видит их у себя в телефоне. Читается из БД (`assertAssignableStaff` в `task-service.ts`, `listStaffPerformers` в `users.ts`), роль при этом не проверяется — сегодня флаг у водителей Александра и Николая, завтра его получат сотрудники цеха, и ролевую модель это не тронет. Изоляция задач не меняется: телефон ходит только в `/api/my/tasks`, чужая задача — 404.
  - Модуль станков изоляции «по владельцу» не имеет by design (все три роли видят весь парк — это общая картотека, а не личные задачи), поэтому вся его защита — ролевая: `requireMachineUser()` в каждом handler'е, включая раздачу фото `GET /api/machines/photos/:id`. Водитель к любому `/api/machines/*` получает **404** (не 403 — не раскрываем существование модуля).
  - Участие в KPI/зарплате = наличие АКТИВНОГО денежного профиля (`DriverPayProfile.isActive`). Водители без профиля (подменный Николай, внешний перевозчик) исключены из детектора нарушений, списка кандидатов, ручных отметок и расчёта; экран «Мой расчёт» им не показывается (`isPayrollDriver`). Это единственный признак участия — отдельного флага в схеме нет.

- **Роль `EMPLOYEE` (18.08.2026, §4д) — учётка, у которой не бывает сессии.** Сотрудника без доступа заводит `POST /api/team`, и войти под ним нельзя по трём независимым причинам сразу: `canLogin=false` (проверяется в `authorize`), пароль случайный (uuid — не известен никому и нигде не показывается), а включить вход некому — админские ручки доступа (`/api/admin/drivers`) работают ТОЛЬКО с `role='DRIVER'`, для остальных 404. Прав роль не даёт и сама по себе: её нет ни в одном белом списке (`isDispatcherRole`, `isTaskManagerRole`, `isMachineRole`, точное сравнение в `requireDriver`), а `equipmentAccess`/`staffTasksAccess` — отдельные флаги, до которых справочник не дотягивается. Роль, логин, вход и флаги доступа не принимаются из тела запроса вовсе: их ставит `createEmployee`, а в типе патча (`TeamMemberPatch`) таких полей физически нет — справочник коллег не должен уметь раздавать права.
- **Гейты вкладки «Команда»** (§4д): чтение `GET /api/team` — `requireTaskManager()` (Д, А, С — это общий календарь команды), любая запись (`POST`/`PATCH`/`DELETE /api/team/:id`) — `requireDispatcher()` (Д, А): менеджер-сервисник смотрит, но кадровых записей не ведёт. Изоляции «по владельцу» у экрана нет by design (как у картотеки станков — справочник общий); вместо неё две доменные границы: у учётки С доступом сервис принимает только `birthday`, а «неживые» для экрана (уволенный, внешний перевозчик, не-`EMPLOYEE` в `deactivateEmployee`) получают **404**, а не подсказку о своём существовании. У `/api/absences` гейты не менялись (чтение — Д/С, запись — Д/А); расширилось только множество людей, которым можно завести отсутствие.

## 7. API (route handlers)

| Метод и путь | Кто | Что |
|---|---|---|
| POST /api/auth/[...nextauth] | все | вход/выход |
| GET /api/tasks?date&status&assigneeId&q&hideCancelled&scope&kind | Д, С | список с фильтрами. `hideCancelled=1` — без отменённых (доска, планирование, окно дня календаря, 11.08); `scope=archive` — раздел «Архив» (11.08). `q` (20.07.2026): ILIKE по title/orgName/invoiceNumber/contactName/address/description/equipment/contactPhone + № заявки (короткие числа, включая «№615») + № цеха («Ц-5», «ц5», «c5», 16.08.2026); ≥3 цифр в запросе — доп. поиск по цифрам телефона (`regexp_replace`, «8…»≈«+7…», параметризованный $queryRaw) |
| POST /api/tasks | Д, С | создать (номер выдаёт сервер: сквозной + «Ц-N» у цеха). `kind: "STAFF"` — задача сотруднику: тип подставляет сервер, адрес/деньги/акт не принимаются; напарник принимается с 16.08.2026 и проверяется по доступу к задачам сотрудникам (PRD §17) |
| GET /api/staff-performers | Д, С, А | кому можно ставить задачи сотрудникам (`User.staffTasksAccess`) |
| PATCH /api/tasks/:id | Д, С | редактирование полей (op:edit, в т.ч. напарник coDriverId — 20.07; у задачи цеха поля доставки — тип/адрес/деньги/пропуск/акт — отбрасываются доменом, 16.08), назначение (op:assign, swap-правило пары), перенос, **архив/возврат** (op:archive\|unarchive, 11.08: мягкое удаление дубля; закрытый месяц — PERIOD_CLOSED) |
| GET /api/my/tasks?date&scope=today\|upcoming | В | только свои: ответственный ИЛИ напарник, владение из сессии (myTasksWhere). today: на сегодня + просроченные открытые + без даты; upcoming: завтра+ |
| GET /api/tasks/:id | Д, В(своя) | карточка + события + вложения |
| POST /api/tasks/:id/transition {toStatus, comment?, lat?, lng?, paymentConfirmed?, paymentAmount?} | по матрице | смена статуса + событие + пуш; DONE: фото (requiresPhoto) и «деньги получены» (ON_SITE) — серверные гейты |
| POST /api/tasks/:id/comments | Д, В(своя) | комментарий |
| POST /api/tasks/:id/attachments (multipart, `kind=PHOTO\|DOCUMENT`) | Д, В(своя) | фото (сжатие ~1920px) или акт (этап 14: DOCUMENT — фото/PDF подписанного бланка). Приложение акта на расценённой ведомости закрывает её цикл PRICED→SIGNED (PRD §13.4); удаление последнего акта откатывает SIGNED→PRICED |
| GET /api/attachments/:id | Д, В(своя) | файл с проверкой прав (nosniff, не из public/) |
| DELETE /api/attachments/:id | Д, В(автор, до завершения) | удалить вложение |
| POST /api/push/subscribe | Д, В | сохранить подписку |
| GET /api/my/shift?date · POST /api/my/shift {op:open\|close\|reopen} | В | смена водителя: прочитать/открыть/закрыть/переоткрыть (driverId из сессии) |
| GET /api/shifts?date | Д | смены за день для доски (запросы на подтверждение) |
| POST /api/shifts/:id/confirm | Д | подтвердить открытие смены (REQUESTED→OPEN), опц. правка времени открытия |
| GET /api/shifts/stale?before | Д | незакрытые смены прошлых дней («зависшие», 03.08) — водитель забыл закрыть, день выпал из сводки и расчёта |
| PATCH /api/shifts/:id {op:reopen} · {op:close, closedAtDate?, closedAtTime?, reason?} · {openedAtTime\|closedAtTime, closedAtDate?, reason} | Д | переоткрыть / закрыть за водителя (№2) / правка времени открытия-закрытия задним числом (№3); работа по shiftId, личность из сессии. `closedAtDate` (03.08) — дата закрытия, отличная от дня смены (смена через полночь, забытая смена): требует причину, длительность ≤ 24 ч, закрытый месяц проверяется по дню закрытия И по дню смены |
| GET /api/summary/shifts?granularity&date&driverId | Д | история смен за период для «Сводки» (№3) |
| GET /api/ui-prefs · PUT /api/ui-prefs {key,value} | любой | персональная раскладка экранов (порядок/свёрнутость пулов); userId из сессии, key из белого списка, value санируется |
| GET /api/team | Д, С, А | справочник коллектива: люди, ближайшие дни рождения, незакрытые отсутствия (PRD §18). Логин и хэш пароля не отдаются никогда |
| POST /api/team {name, position?, phone?, birthday?} | Д, А | завести сотрудника БЕЗ доступа в систему: роль `EMPLOYEE`, `canLogin=false`, технический логин `emp-<uuid>` и случайный пароль ставит сервис — из тела эти поля не приходят |
| PATCH /api/team/:id {name?, position?, phone?, birthday?} | Д, А | правка карточки: у сотрудника без доступа — целиком, у учётки с доступом — ТОЛЬКО `birthday` (остальное ведёт «Управление»). Патч собирается по белому списку ключей |
| DELETE /api/team/:id | Д, А | убрать из справочника — мягко (`isActive=false`), отпуска и история остаются; только для `EMPLOYEE` |
| GET /api/absences?from&to | Д, С | отсутствия за период (календарь загрузки, «Команда») |
| POST /api/absences · DELETE /api/absences/:id | Д, А | завести/удалить отпуск или больничный. `driverId` — за другого (исключение из правила «личность из сессии»), с 18.08.2026 это любой действующий внутренний сотрудник, не только водитель (PRD §18); создавший — из сессии |
| GET/POST /api/admin/users, /api/admin/task-types | А | справочники |
| GET /api/admin/drivers · PATCH {driverId, canLogin\|isExternal} · POST /api/admin/drivers/password | А | экран «Водители — доступ»: вход, признак «внешний перевозчик» (03.08), смена пароля (03.08). Менять можно ТОЛЬКО пользователя с ролью DRIVER (иначе 404 — защита от захвата учётки диспетчера/админа); пароль только в теле, не логируется и не возвращается |
| GET /api/work-catalog | Д, В | справочник работ для ведомости, сгруппирован по разделам; для водителя — БЕЗ цены (id+name+раздел) |
| POST /api/tasks/:id/work-items · PATCH/DELETE /api/work-items/:id | В(своя), Д | позиции ведомости (этап 12; правка пока DRAFT, чужая → 404) |
| POST /api/tasks/:id/worksheet/submit | В(своя), Д | отправить ведомость на расценку (DRAFT→PRICING) + пуш диспетчерам |
| POST /api/tasks/:id/worksheet/pricing | Д | проставить цены по позициям и подтвердить расценку (PRICING→PRICED) (этап 13) |
| GET /api/worksheets/pricing | Д | очередь ведомостей «на расценке» (этап 13) |
| GET/POST /api/admin/work-catalog · PATCH /api/admin/work-catalog/:id | А | справочник работ (название, цена-подсказка, раздел, активность) |
| GET/POST /api/admin/work-categories · PATCH /api/admin/work-categories/:id | А | разделы справочника (группы услуг/товаров) |
| GET /api/kpi/overview?period | Д | кандидаты в нарушения + расчёт по всем водителям за месяц (объединяет candidates+statements одним запросом) |
| GET /api/summary/overview?granularity&date | Д | сводка по водителям за период (день/неделя/месяц, по дате закрытия задач) — Фаза 2, только чтение |
| GET /api/summary/export?granularity&date | Д | та же сводка файлом CSV (вложение, BOM+`;` для Excel) |
| GET /api/capacity/calendar?from&to | Д | загрузка водителей по дням за период (Фаза 2, §4б): часы/число задач на (водитель, день) — только чтение |
| POST /api/kpi/detect {date?} | Д | ручной прогон детектора кандидатов (та же логика, что ночной cron); идемпотентно |
| POST /api/kpi/marks | Д | добавить отметку вручную (штраф или поощрение) |
| POST /api/kpi/marks/:id/resolve {status} | Д | подтвердить/отклонить кандидата (CONFIRMED/DISMISSED) |
| POST /api/kpi/periods/:period/close | Д | закрыть месяц — заморозить снимок PayrollStatement |
| GET /api/my/kpi?period | В | мой расчёт за месяц (driverId из сессии; чужой → 404) |
| GET/PUT /api/admin/pay-profiles, /api/admin/kpi-rules, /api/admin/kpi-settings | А | оклад/премия по водителю, веса штрафов, прогрессия/порог |
| GET/PUT /api/admin/capacity-settings, /api/admin/traffic-windows | А | база/рабочий день/скорость/петляние/обратная дорога; коэффициенты пробок (Фаза 2, §4б) |

Модуль «Станки» (§4г, PRD §16) — все ручки доступны ровно трём ролям (С — менеджер-сервисник, Д — диспетчер, А — админ); водителю **404**:

| Метод и путь | Кто | Что |
|---|---|---|
| GET /api/machines?family=BENDER\|SEAMER&scope=active\|archive&category&status&kind&flag&q&take&skip | С, Д, А | список станков + счётчики сводки. `scope` — область просмотра (площадка/архив), `category` — одна категория, фильтрует через `categories has` (станок с двумя категориями виден в обеих), `kind` — вид, `flag` — фильтр по плитке сводки (`urgent`, `duePressing`, `awaitingDiagnosis`, `notVerified`; при `duePressing` — сортировка по `dueDate` asc). Активные отдаются целиком (десятки), архив — постранично с серверным поиском `q` (номер в любой схеме и написании — «77-5», «К-5», «k5», модель, № заказа 1С, комплектация, дефектовка) |
| POST /api/machines {categories: [...], ...} | С, Д, А | завести станок. Обязательны только `categories` (непустой допустимый набор) и `model`; `number` выдаёт сервер (sequence), `ourNumber`/`clientNumber` — подсказка следующего или ручной ввод. Состояние новой карточки — `NEEDS_REPAIR` |
| GET /api/machines/:id/kit | С, Д, А | свободные комплектующие раздела: ножи вне чужих комплектов и складские позиции с ненулевым остатком |
| POST /api/machines/:id/kit {partId, qty} | С, Д, А | поставить комплектующую в комплект (повтор с тем же partId = правка количества). Idempotency-Key обязателен по смыслу: повтор после таймаута не должен списывать остаток дважды |
| DELETE /api/machines/:id/kit/:partId | С, Д, А | разобрать комплект; списанную связь (проданный комплект) разобрать нельзя — она история |
| GET /api/machines/meta?family=BENDER\|SEAMER | С, Д, А | справочные данные формы одним запросом: подсказки следующего свободного номера сразу по обеим схемам (`nextOurNumber` «77-N», `nextClientNumber` «К-N» — категории в форме переключают, и подсказка меняется без второго запроса) + сотрудники офиса для поля «ответственный» + `models` (distinct по картотеке — сырьё подсказок комбобокса) + `suppressedModels` (скрытые крестиком названия; пул собирает клиент) |
| POST \| DELETE /api/machines/models {family, name} | С, Д, А | скрыть / вернуть подсказку модели (20.08.2026). Обе операции идемпотентны по природе (upsert и deleteMany), Idempotency-Key не нужен. Карточки не меняются — прячется только подсказка; заведение карточки с этим названием снимает подавление |
| GET /api/machines/:id | С, Д, А | карточка + журнал + фото |
| PATCH /api/machines/:id {op:edit\|status\|category\|diagnosed\|verified, withKit?} | С, Д, А | правка полей, включая `kind`, `price` и `dueDate` (журнал пишет «было→стало»), смена состояния (валидация совместимости с категориями; `VOIDED` требует причину; выход из `RENTED` в неархивное сбрасывает отметки диагностики и сверки), смена НАБОРА категорий (`{categories: [...]}` — приходит полный набор, проверяется и применяется атомарно), отметки «диагностика проведена» / «подтверждён на месте» |
| POST /api/machines/:id/comments | С, Д, А | комментарий в журнал (лента «Комментарии» карточки) |
| POST /api/machines/:id/shop-task {note, toInRepair} | С, Д, А | зафиксировать «Задание в цех»: событие `shop_task` с полным текстом (собирается сервером из карточки + `note`); при `toInRepair` — той же транзакцией перевод в `IN_REPAIR`. Idempotency-Key обязателен по смыслу: повтор после таймаута не плодит дубли задания |
| POST /api/machines/:id/attachments (multipart) | С, Д, А | фото станка (сжатие ~1920px на клиенте); карточка сохраняется до фото, догрузка с автоповтором |
| GET /api/machines/photos/:id | С, Д, А | файл с проверкой прав (nosniff, не из public/). Путь намеренно не `/api/machines/attachments/:id` — тот пересекался бы с `/api/machines/:id/...` |
| DELETE /api/machines/photos/:id | С, Д, А | удалить фото: автор либо диспетчер/админ (событие в журнал) |

Контракт ответов: `{ data }` или `{ error: { code, message } }`; коды ошибок доменные (`FORBIDDEN_TRANSITION`, `PHOTO_REQUIRED`, `NOT_FOUND`, `PERIOD_CLOSED`, `MACHINE_STATUS_CATEGORY` — состояние не подходит категории).

## 8. Real-time, пуши, фоновые задачи

- MVP: SWR с `refreshInterval: 10_000` на доске и в списке водителя + мгновенный optimistic update своих действий. Для 3 пользователей этого достаточно; SSE — этап 6, только если поллинг будет ощущаться.
- Push (этап 5, реализовано): при назначении/изменении/переносе/отмене задачи `task-service` вызывает `notifyTaskAssignee` (fire-and-forget) → web-push всем подпискам водителя; с 20.07.2026 изменения/переносы/отмены/расценка уходят ОБОИМ участникам пары (кроме автора действия), а при добавлении напарника ему шлётся отдельный `buildCoDriverPayload` «Ты напарник по заявке №N». Payload минимальный (номер, заголовок, deeplink в карточку). Подписка/отписка устройства — `POST /api/push/{subscribe,unsubscribe}` (личность из сессии). Service worker `public/sw.js` показывает уведомление и по тапу открывает/фокусирует карточку. Протухшие подписки (404/410) сервис удаляет. Не уведомляем актора, если он сам — исполнитель.
- Планировщик (node-cron в том же процессе, этап 5): старт из `src/instrumentation.ts` (`register`, только Node-рантайм) → `src/lib/cron.ts`. Утреннее напоминание водителям (08:00), дни рождения коллег (09:00, 18.08.2026), предупреждение диспетчеру о незаказанных пропусках на завтра (16:00) и напоминание «смена ещё открыта» водителям с незакрытой сменой (21:00, решение Артёма 03.08 — устраняет причину зависших смен), таймзона `CRON_TZ` (по умолч. Europe/Moscow). **Один процесс на проде** — иначе задачи задвоятся (deploy-release: не запускать в кластере/нескольких репликах). Защита от повторной регистрации — флаг в `globalThis` + `cron.getTasks()`.
- **Дни рождения коллег (09:00 МСК, 18.08.2026, PRD §18).** `runBirthdayReminders` (`push-service`): берёт действующих внутренних сотрудников с заполненным `birthday`, чистой функцией `birthdaysOn` считает именинников на сегодня и на «сегодня+3» и рассылает три разных текста (`buildBirthdaySoonPayload` / `buildBirthdayTodayPayload` / `buildBirthdayGreetingPayload`). Получатели — `isActive && canLogin && !isExternal` (внешний перевозчик не коллега; у сотрудников без входа подписок и не бывает), именинник исключён из рассылки про себя и вместо неё получает поздравление. `url: "/"` у всех трёх — корень разводит по ролям, вкладки «Команда» у водителя нет. `tag` — на конкретного человека, иначе два именинника в один день схлопнулись бы в одно уведомление. Дедупликации не нужно: задача суточная. Час выбран отдельно от 08:00 (Артём) — иначе пуш водителю слипся бы с утренним списком задач. Побочный эффект решения: менеджер-сервисник впервые попал в рассылку, поэтому кнопка «Включить уведомления» ему больше не прячется (`PwaControls`, проп `withPush` оставлен на случай раздела без рассылок).
- KPI-детекторы (Фаза 1.5, тот же node-cron, ночной прогон ~23:30): за день создаёт кандидатов в `KpiMark` со `status=CANDIDATE` — **поздно открыл смену** (по подтверждённым/закрытым сменам: `openedAt` позже порога `shiftStartMinutes + shiftLateGraceMinutes`, по умолчанию 9:15; заменяет прежнее «опоздание на объект»), **не подписан акт** (задача с `requiresSignedDoc`, DONE, а первое DOCUMENT-вложение не приложено к дедлайну 20:00 МСК дня завершения; завершение после 20:00 → дедлайн 20:00 следующего дня, поэтому окно выборки по `completedAt` — сутки назад; `occurredAt` кандидата = момент дедлайна), не выполнена точка (назначенная на день задача не в DONE/CANCELLED/RESCHEDULED). Идемпотентно: задачные метрики по `@@unique([taskId, kind])`, метрика смены по `@@unique([shiftId, kind])` — безопасно повторно прогонять. Неоднозначное окно времени (нечитаемый `timeTo`) — пропускаем, Милена добавит вручную. Решение по каждому кандидату — за Миленой, авто-штрафов без подтверждения нет.
- Вечерний прогон актов (20:05, `runActDeadlineDetection`): только детектор UNSIGNED_DOCS (полный прогон в 20:05 плодил бы ложные «невыполненные точки» по задачам, которые водитель ещё доделает) + пуш диспетчерам «Акты не приложены — N задач» (deeplink на /kpi), если за сегодня есть неразобранные кандидаты по актам. Ночной прогон 23:30 остаётся подстраховкой. При завершении актовой задачи без акта водитель обязан передать `actMissedReason` (гейт `ACT_REASON_REQUIRED` в `transitionTask`, только для роли DRIVER — диспетчер ведёт статусы за исполнителя без причины); причина хранится на `Task.actMissedReason`, дублируется событием `act_missing_reason` и попадает в note кандидата.

## 9. Деплой и эксплуатация

- VPS в РФ (2 vCPU / 2–4 ГБ): Docker Compose — `app` (Next.js standalone), `postgres` (volume `pgdata`), `caddy` (80/443, авто-TLS). Фото — volume `/data/uploads`.
- Бэкапы (cron на VPS): `pg_dump` ежедневно + tar uploads, хранение 14 дней локально + копия наружу (рекомендация: S3-совместимый бакет или хотя бы rsync на второй сервер/диск). Восстановление отрепетировать до пилота.
- Релиз: см. skill deploy-release (миграции → бэкап → up → healthcheck → smoke).
- Env: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, `SEED_PASSWORD`, `UPLOADS_DIR`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (тот же публичный ключ — уезжает в браузер для подписки), `CRON_TZ`, `GEOCODER_PROVIDER`/`GEOCODER_USER_AGENT`/`DADATA_API_KEY`/`DADATA_SECRET` (геокодер ёмкости, Фаза 2 §4б; на проде — `dadata` + ключ). Секреты — только в `.env` на сервере, в репозитории — `.env.example`.
- Прод-сид менеджера-сервисника (§4г): `pnpm db:seed:service-manager` — заводит ОДНОГО пользователя с ролью `SERVICE_MANAGER` (логин `SM_LOGIN`, имя `SM_NAME` — по умолчанию `maxim`/«Максим»; пароль `SEED_PASSWORD_MAXIM`, иначе общий `SEED_PASSWORD`). Пароль ставится ТОЛЬКО при создании: существующему пользователю сид меняет разве что роль и **никогда не трогает пароли**. Полный `pnpm db:seed` на проде запрещён — он перезатирает пароли всей команды (урок этапов 11–15).
- Прод-сид параметров ёмкости (Фаза 2): `pnpm db:seed:capacity` — безопасный (не трогает пользователей/пароли), ставит нормы типов, окна пробок, специализацию и настройки базы. Запускать после миграции `capacity_calendar`.
- Логи: pino в stdout, `docker logs`; событийный журнал доступа — TaskEvent + auth-лог.

## 10. Тестирование

- Unit (Vitest): статусная матрица (все разрешённые/запрещённые переходы), authz-функции, нумерация. KPI (Фаза 1.5): детекторы нарушений (опоздание/акт/точка на граничных данных), прогрессивный расчёт (0 ошибок = полная премия; прогрессия с 3-го нарушения; штрафы максимум обнуляют премию — итог не ниже оклада; режим ZERO — не ниже 0; сверка с примером PRD §12.3), идемпотентность детектора. Ёмкость (Фаза 2): haversine-расстояние, перевод в минуты с коэффициентами петляния/пробок, выбор окна `TrafficWindow` по `timeFrom` (включая отсутствие времени), оценка задачи на граничных данных; агрегация загрузки по дням.
- Станки (§4г): совместимость категория×состояние на всех парах, архивные состояния и обязательность причины при `VOIDED`, «было→стало» в журнале правки, счётчики сводки на граничных данных (рабочий день от `arrivedAt`, неделя от `lastVerifiedAt`, пороги срока `machineDueState` включая границу МСК-суток и счётчики по видам), умный поиск (номер обеих схем «77-N»/«К-N» в любом написании, телефон, раскладка, подпись вида у ножей), схема нумерации по происхождению и переезд номера за категорией (`machine-number.ts`), подбор моделей (транслит кириллица↔латиница, дедуп пула с БД), текст задания в цех (`buildShopTaskText`: состав, «СРОЧНО!», пропуск пустых полей).
- Команда (§4д): дни рождения — совпадение даты без года, 29 февраля в високосный и невисокосный год, ближайшая дата через Новый год, горизонт списка и `inDays`, подпись «21 августа» в родительном падеже (`birthdays.test.ts`); тексты и теги трёх пушей о ДР (`notifications.test.ts`); маршрут и подпись новой роли (`roles.test.ts`).
- e2e (Playwright): сценарий «Милена создала → назначила → водитель принял → выехал → на месте → фото → выполнено»; тесты изоляции (обязательно); требование фото при DONE. Изоляция роли SERVICE_MANAGER — **в обе стороны**: смоук «менеджер-сервисник → каждый существующий раздел = 403/404/redirect» (с адресными проверками денежных ручек KPI/зарплаты/сводки) и «водитель → любая ручка станков = 404». KPI: водитель видит только свой расчёт (чужой → 404); водительские ручки KPI не дают подтверждать/настраивать; закрытый месяц не меняется при правке отметок. Офлайн: действие без сети встаёт в очередь (оверлей + «не отправлено»), при возврате связи досылается, статус долетает до сервера (`offline.spec.ts`).

## 11. Офлайн-режим водителя (Фаза 2)

Решения Артёма 23.06.2026. На объектах часто нет сети, а водитель должен мочь вести работу: смотреть свои задачи, менять статусы, фотографировать, заполнять ведомость. Реализовано в `src/lib/offline/` + серверная идемпотентность. Только клиент водителя (Android/Chrome; айфонов в парке нет).

**Два слоя.** Данные и действия живут на уровне приложения (IndexedDB), холодный старт — на уровне SW:
- **Чтение** (`cached-fetcher.ts`): GET через SWR кэшируется в IndexedDB (store `responses`); без сети (`ApiError status 0`) отдаётся сохранённое. Список «Мои задачи» и карточка открываются офлайн. Статус смены тоже кэшируется. «Наутро без связи» (O7): ключи с параметром `date` меняются в полночь, поэтому каждый ответ дополнительно пишется под стабильным ключом без `date` (`latest:`-запись, `stableKey()`); промах точного ключа офлайн откатывается на него, UI показывает бейдж давности («Данные за …», порог 30 мин, `readCachedMeta`). Вчерашняя ЗАКРЫТАЯ смена из такого фолбэка нормализуется в «сегодня не открыта» (`currentShift()` в overlay.ts).
- **Запись** (`send.ts`/`sync.ts`/`queue.ts`): мутация онлайн уходит сразу; офлайн/нет сети/5xx — в очередь (store `queue`, FIFO по `seq`). Синхронизатор (`useOfflineSync` в layout водителя) досылает при возврате связи / на старте / каждые 15 с; после досылки — ревалидация SWR. Фото — сжатый blob в store `blobs`, после успешной отправки удаляется. **Background Sync (O11):** `putQueued` регистрирует `sync`-тег `vanmark-queue`, и браузер досылает очередь из SW (`replayQueue` в `sw.js`, raw-IndexedDB, та же логика 401/5xx/4xx) даже при свёрнутом приложении; по завершении шлёт вкладке `queue-replayed`. Досылка из вкладки (`processQueue`) и из SW координируются Web Lock `vanmark-queue` (ifAvailable — не мешают друг другу); гонки страхует серверная идемпотентность. Нет Background Sync API → тихая деградация к тикам. Реестр `ProcessedAction` чистится ночным cron (`cleanupProcessedActions(60)`, 60 дней ≫ окна достоверности 36 ч).
- **Оверлей** (`overlay.ts`, чистые функции, unit-тесты): статус задачи отражает последний неотправленный переход — список и карточка сразу показывают «В работе»/«Завершена». Бейджи «⏳ ждёт» / «Не отправлено: N» / «+N фото в очереди».
- **Холодный старт** (`public/sw.js`): рукописный Cache API — статика cache-first (хэширована → безопасно), навигация network-first с откатом в кэш; precache иконки + оболочка `/m`. Guard на localhost: в dev отключён (не ломает HMR). **Версионирование (O9):** имя кэша `vanmark-app-<версия>`, где версия из `public/sw-version.js` (генерит `scripts/stamp-sw-version.mjs` в `prebuild`: git sha, иначе timestamp сборки — `.git` исключён из Docker-контекста); `sw.js` подхватывает через `importScripts`, `activate` удаляет кэши прошлых версий, навигации LRU-обрезаются до 30. **Логин-ловушка (O9):** в кэш кладём только «настоящие» ответы навигаций (`res.ok && !redirected && не /login`) — иначе SW, вставший до входа, закэшировал бы под `/m` HTML логина и офлайн отдавал бы тупик; `/login` обслуживается только сетью; после входа `OfflineSync` шлёт SW `warm-shell` (перекэшировать `/m` чистым ответом). **Тестируемость (O9):** на localhost кэш включается флагом `?cache=on` в URL регистрации (сборка с `NEXT_PUBLIC_SW_CACHE=on`); профиль `pnpm e2e:sw` (`playwright.sw.config.ts`, `e2e/sw/`) поднимает прод-сервер и гасит его для эмуляции офлайна — впервые автоматизирует холодный старт (раньше только ручная приёмка на проде). **Просмотр всего офлайн (O10):** `usePrefetchCards` при связи и смене набора id тихо кэширует данные карточек видимого списка (`cachedFetcher` → IndexedDB) и справочник, затем шлёт SW `warm-pages` (прогрев HTML) — офлайн открывается любая задача дня; из списка офлайн-переход идёт через `<a>` (полная навигация в SW), онлайн — быстрый `<Link>`. Фото/акты кэшируются в SW cache-first в отдельный `vanmark-photos-v1` (LRU ≤100, `activate` его не чистит — вложения иммутабельны по uuid); в кэш попадают только ответы, уже авторизованные сервером для этого пользователя (модель как у IndexedDB — один телефон = один водитель). Офлайн-снятые, ещё не отправленные фото показываются из локального blob (`PendingPhotos`). `/m/payroll` — тоже `cachedFetcher`.

**Идемпотентность и время.** Каждое действие несёт `Idempotency-Key` (uuid) и `X-Occurred-At` (момент действия). Сервер (`ProcessedAction`, `withIdempotency`) применяет действие ровно один раз — повтор досылки возвращает сохранённый результат (иначе задвоились бы фото/комментарий или упал бы второй DONE из DONE). Время события (`TaskEvent.at`, `completedAt`) берётся из `X-Occurred-At` с проверкой достоверности (`occurred-at.ts`: окно [now−36ч; now+2мин], иначе время сервера). Чужой ключ → 404 (та же изоляция, что у задач).

**Границы (осознанные).**
- Изоляцию задач и статусную матрицу офлайн НЕ ослабляем: сервер — финальный арбитр. Доменная ошибка при досылке (диспетчер изменил задачу) помечает действие «конфликт», показывается водителю и не блокирует остальные действия.
- **Разбор конфликтов и сбои сессии** (O8, `runQueueOnce`/`ConflictCenter`/`auth-required.ts`): конфликтные действия водитель разбирает сам — баннер «Не прошло — разобрать» → шторка с причинами → кнопка «Убрать» (`discardAction` чистит очередь и связанный blob; «Повторить» не делаем — нужное действие проще выполнить заново, решение Артёма 02.07). `overlayStatus` учитывает только pending/syncing, поэтому отклонённый переход больше не искажает статус. 401 при досылке (сессия истекла) — не конфликт: очередь останавливается, поднимается флаг `authRequired` (баннер «войдите заново»), после входа первое успешное действие снимает флаг и досылка продолжается. 403 (доменный отказ в правах при живой сессии: чужое фото, ведомость напарником) — КОНФЛИКТ, очередь продолжает (до 31.07 403 останавливал досылку навсегда под ложным «войдите заново»); сервер гарантирует границу: `requireApiUser` на отсутствие сессии бросает строго 401. Видимость затора (31.07, `queue-health.ts`): самое старое pending старше 10 мин при онлайне → янтарный баннер «Действия не отправляются уже N мин…» с инструкцией (перезапуск → звонок Милене); автоконфликтов по возрасту нет — инфраструктурные 5xx/обрывы по-прежнему не считаются к порогу, чтобы деплой или долгий офлайн не уводили действия в ложный конфликт. Потерянный blob фото (эвикция IndexedDB) → доменная ошибка `BLOB_MISSING` (конфликт с причиной), а не тихий успех; `navigator.storage.persist()` в `OfflineSync` снижает риск эвикции. Порядок досылки строго FIFO: монотонный `nextSeq` + тай-брейк по id; при непустой очереди даже онлайн-действие встаёт в хвост (не обгоняет FIFO), а онлайн-HTTP 500 показывается сразу и в очередь не кладётся (решения Артёма 31.07).
- **Смена офлайн** (O7, решение Артёма 02.07.2026 — заменяет прежнюю границу «только онлайн»): open/close/reopen идут через ту же очередь (kind `shift`), `/api/my/shift` обёрнут `withIdempotency`. День и время смены сервер считает от достоверного момента нажатия (`resolveOccurredAt`, clamp 36 ч) — клиентскому `today` по-прежнему не доверяем. Досылка старше 60 с помечает смену `Shift.openedOffline` — Милена видит «офлайн (время телефона)» и может поправить время при подтверждении (№3); это и есть контроль против подкрутки часов. Повтор open того дня идемпотентен (возвращает существующую смену), close/reopen при промахе дня закрывают/поднимают последнюю подходящую смену (досылка «за полночь»); совсем без смены close даёт мягкую доменную ошибку (конфликт с причиной, не тупик очереди). Блок смены на `/m` и гейт «В работу» в карточке считают состояние по `overlayShift()` — офлайн-открытая смена работает сразу, не дожидаясь досылки.
- **Расценку ведомости** офлайн не получить by design (нужна Милена онлайн) — PRD §13 это допускает (закрывается, фото акта позже).
- Пер-элементный оверлей комментариев/позиций ведомости не делаем (3 пользователя, конфликты редки) — их содержимое подтянется ревалидацией после досылки; до этого виден индикатор «ждёт отправки».
- Definition of Done любой фичи — в CLAUDE.md.

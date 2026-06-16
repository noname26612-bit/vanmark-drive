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
| PWA | Serwist (наследник next-pwa) + Web App Manifest | водители — Android/Chrome |
| Push | Web Push API + библиотека web-push (VAPID) | подписки в БД |
| Фото | локальный volume + раздача через route handler с проверкой прав | S3-совместимое хранилище — фаза 3 |
| Деплой | Docker Compose: app + postgres + Caddy (авто-HTTPS) | VPS в РФ (Timeweb Cloud / Selectel) |
| Тесты | Vitest (unit/домен) + Playwright (e2e) | обязательные тесты изоляции |

При инициализации проекта Claude Code обязан проверить актуальные стабильные версии (Next.js, Prisma, Auth.js, Serwist, Tailwind) и зафиксировать их в package.json — не брать версии из этого документа на веру.

## 3. Структура проекта

```
src/
  app/
    (dispatcher)/board/...      # доска Милены: «Сегодня», «Все задачи», карточка
    (driver)/m/...              # PWA водителя: «Мои задачи», карточка, завершение
    api/                        # route handlers (REST)
    login/
  domain/                       # ЯДРО: статусная матрица, права, доменные сервисы
    task-status.ts              # допустимые переходы + кто может
    authz.ts                    # canView / canTransition / assertOwnership
    task-service.ts             # создание, назначение, смена статуса (+события, +пуши)
    kpi.ts                      # KPI (Фаза 1.5): детекторы нарушений + прогрессивный расчёт (чистые функции, юнит-тесты)
    kpi-service.ts              # KPI: кандидаты, подтверждение/отклонение, ручные отметки, закрытие месяца, расчёт водителя (с изоляцией)
  lib/                          # prisma client, auth, push, upload, утилиты
  components/                   # ui-компоненты
prisma/schema.prisma
docker-compose.yml / Caddyfile
.claude/skills/                 # скиллы агента (см. папку skills)
CLAUDE.md
```

Правило: route handlers — тонкие (распаковка запроса → вызов domain-сервиса → ответ). Вся логика и проверки прав — в `src/domain/`.

## 4. Модель данных (Prisma)

```prisma
enum Role        { ADMIN DISPATCHER DRIVER }
enum TaskStatus  { NEW ASSIGNED ACCEPTED EN_ROUTE ON_SITE DONE ON_HOLD RESCHEDULED CANCELLED }
enum PassStatus  { NOT_NEEDED NEEDED ORDERED }
enum PaymentType { NONE OFFICE ON_SITE }
enum AttachmentKind { PHOTO DOCUMENT }

model User {
  id            String   @id @default(uuid())
  login         String   @unique
  passwordHash  String
  name          String                 // «Милена», «Алексей Писарев»
  phone         String?
  role          Role
  isActive      Boolean  @default(true)
  canLogin      Boolean  @default(true)   // false — внешний исполнитель (Султан): статусы ведёт диспетчер
  tasks         Task[]   @relation("assignee")
  createdTasks  Task[]   @relation("creator")
  events        TaskEvent[]
  pushSubs      PushSubscription[]
  createdAt     DateTime @default(now())
}

model TaskType {
  id            String  @id @default(uuid())
  name             String  @unique       // «Доставка в аренду», «Забор в ремонт»...
  icon             String?                // имя иконки lucide
  requiresPhoto    Boolean @default(true) // обязательное фото при DONE (гейт)
  requiresSignedDoc Boolean @default(false) // ремонтный тип: ожидается подписанный акт. НЕ гейт — отсутствие = нарушение KPI (Фаза 1.5)
  sortOrder        Int     @default(0)
  isActive         Boolean @default(true)
  tasks            Task[]
}

model Task {
  id            String     @id @default(uuid())
  number        Int        @unique        // сквозной, sequence (старт задаёт сид)
  typeId        String
  type          TaskType   @relation(fields: [typeId], references: [id])
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
  createdById   String
  createdBy     User       @relation("creator", fields: [createdById], references: [id])
  cancelReason  String?
  holdReason    String?
  events        TaskEvent[]
  attachments   Attachment[]
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  completedAt   DateTime?

  @@index([assigneeId, scheduledDate])
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

## 4а. Модель данных KPI и зарплаты (Фаза 1.5)

Добавляется аддитивной миграцией поверх §4 (никаких изменений существующих таблиц, кроме нового поля `TaskType.requiresSignedDoc`). Принципы PRD §12: KPI = нарушения, расчёт = оклад + (премия − прогрессивные штрафы) + поощрения, закрытый месяц неизменен.

```prisma
enum KpiMarkKind   { LATE UNSIGNED_DOCS MISSED_STOP MANUAL } // 3 авто-метрики + ручная отметка
enum KpiMarkStatus { CANDIDATE CONFIRMED DISMISSED }         // предложено системой → решение Милены

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

// Глобальный вес штрафа по виду нарушения (3 строки). Шаг прогрессии — константа KPI_CONFIG в src/domain/kpi.ts.
model KpiRule {
  id       String      @id @default(uuid())
  kind     KpiMarkKind @unique
  weight   Int                         // базовый штраф ₽ за ошибку этого вида
  isActive Boolean     @default(true)
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
  total       Int                          // итог к выплате (не ниже 0)
  breakdown   Json                         // детализация по отметкам на момент закрытия
  closedById  String
  closedAt    DateTime @default(now())

  @@unique([driverId, period])
}
```

На стороне `User` добавляются обратные связи (`kpiMarks`, `payProfile`, `payStatements`), на `Task` — `kpiMarks`. Детекторы (см. §8) идемпотентны через `@@unique([taskId, kind])`; повторный прогон не плодит дубли.

## 5. Статусная матрица (единственный источник — `src/domain/task-status.ts`)

| Из \ В | ASSIGNED | ACCEPTED | EN_ROUTE | ON_SITE | DONE | ON_HOLD | RESCHEDULED | CANCELLED |
|---|---|---|---|---|---|---|---|---|
| NEW | Д | — | — | — | — | Д | Д | Д |
| ASSIGNED | Д (переназн.) | В | — | — | — | Д | Д | Д |
| ACCEPTED | — | — | В | — | — | Д, В* | Д | Д |
| EN_ROUTE | — | — | — | В | — | Д, В* | Д | Д |
| ON_SITE | — | — | — | — | В (фото!) | Д, В* | Д | Д |
| ON_HOLD | Д | — | — | — | — | — | Д | Д |
| RESCHEDULED → автоматически ASSIGNED на новую дату | | | | | | | | |

Д — диспетчер/админ; В — назначенный водитель; В* — водитель может поставить «Ждёт» только с обязательной причиной (нет пропуска, клиент недоступен). DONE требует фото, если `type.requiresPhoto`, а при `paymentType = ON_SITE` — подтверждение получения денег (сумма пишется в событие); обе проверки на сервере. Любая корректировка статуса диспетчером задним числом — это новый event, история не переписывается.

Уточнено с Артёмом 04.06.2026 (реализовано в `src/domain/task-status.ts`): диспетчер/админ может выполнить ЛЮБОЙ валидный переход матрицы (включая «водительские» шаги вперёд) — это нужно, чтобы вести статусы за внешнего исполнителя (Султан, без приложения) и исправлять ошибки. Водитель — только разрешённые ему рёбра и только по своей задаче. Сами рёбра матрицы не меняются.

## 6. Авторизация и изоляция (критично)

- Сессия: Auth.js, JWT в httpOnly cookie. Личность и роль — ТОЛЬКО из сессии. Клиент никогда не передаёт `userId`/`assigneeId` от своего имени.
- Каждый handler начинается с `const user = await requireUser(req)`; для водительских маршрутов — `requireRole('DRIVER')`.
- Списки водителя: всегда `where: { assigneeId: user.id }` — без исключений.
- Объект по id: `assertCanView(user, task)` — водителю чужая задача отдаёт **404** (не 403, чтобы не раскрывать существование).
- Мутации: `assertCanTransition(user, task, toStatus)` из домена — проверяет и владение, и допустимость перехода по матрице.
- Фото отдаются НЕ из публичной статики, а через `GET /api/attachments/[id]` с теми же проверками прав.
- Rate limit на `/api/auth/*` (брутфорс), пароли — argon2id.
- Обязательные e2e-тесты изоляции (см. skill security-check): водитель A не видит и не может изменить задачу водителя B ни одним эндпоинтом.
- KPI (Фаза 1.5): `GET /api/my/kpi` и расчёт водителя берут `driverId` ТОЛЬКО из сессии; чужой расчёт по прямой ссылке/ID — **404**. Подтверждение нарушений, ручные отметки, настройки оплаты и закрытие месяца — только диспетчер/админ (водитель эти ручки не видит). Каждый KPI-эндпоинт проходит security-check (та же дисциплина, что и задачи).

## 7. API (route handlers)

| Метод и путь | Кто | Что |
|---|---|---|
| POST /api/auth/[...nextauth] | все | вход/выход |
| GET /api/tasks?date&status&assigneeId&q | Д | список с фильтрами |
| POST /api/tasks | Д | создать (номер выдаёт сервер) |
| PATCH /api/tasks/:id | Д | редактирование полей, назначение, перенос |
| GET /api/my/tasks?date&scope=today\|upcoming | В | только свои (assigneeId из сессии). today: на сегодня + просроченные открытые + без даты; upcoming: завтра+ |
| GET /api/tasks/:id | Д, В(своя) | карточка + события + вложения |
| POST /api/tasks/:id/transition {toStatus, comment?, lat?, lng?, paymentConfirmed?, paymentAmount?} | по матрице | смена статуса + событие + пуш; DONE: фото (requiresPhoto) и «деньги получены» (ON_SITE) — серверные гейты |
| POST /api/tasks/:id/comments | Д, В(своя) | комментарий |
| POST /api/tasks/:id/attachments (multipart) | Д, В(своя) | фото (клиент сжимает до ~1920px) |
| GET /api/attachments/:id | Д, В(своя) | файл с проверкой прав (nosniff, не из public/) |
| DELETE /api/attachments/:id | Д, В(автор, до завершения) | удалить вложение |
| POST /api/push/subscribe | Д, В | сохранить подписку |
| GET/POST /api/admin/users, /api/admin/task-types | А | справочники |
| GET /api/kpi/candidates?period | Д | нарушения-кандидаты и подтверждённые за месяц (все водители) |
| POST /api/kpi/marks | Д | добавить отметку вручную (штраф или поощрение) |
| POST /api/kpi/marks/:id/resolve {status} | Д | подтвердить/отклонить кандидата (CONFIRMED/DISMISSED) |
| GET /api/kpi/statements?period | Д | расчёт по всем водителям за месяц |
| POST /api/kpi/periods/:period/close | Д | закрыть месяц — заморозить снимок PayrollStatement |
| GET /api/my/kpi?period | В | мой расчёт за месяц (driverId из сессии; чужой → 404) |
| GET/PUT /api/admin/pay-profiles, /api/admin/kpi-rules | А | оклад/премия по водителю, веса штрафов |

Контракт ответов: `{ data }` или `{ error: { code, message } }`; коды ошибок доменные (`FORBIDDEN_TRANSITION`, `PHOTO_REQUIRED`, `NOT_FOUND`, `PERIOD_CLOSED`).

## 8. Real-time, пуши, фоновые задачи

- MVP: SWR с `refreshInterval: 10_000` на доске и в списке водителя + мгновенный optimistic update своих действий. Для 3 пользователей этого достаточно; SSE — этап 6, только если поллинг будет ощущаться.
- Push: при назначении/изменении/отмене задачи — web-push всем подпискам водителя; payload минимальный (номер, заголовок, deeplink в карточку). Тап по пушу открывает PWA на задаче.
- Планировщик (node-cron в том же процессе): утреннее напоминание водителям (08:00), предупреждение Милене о незаказанных пропусках на завтра (16:00).
- KPI-детекторы (Фаза 1.5, тот же node-cron, ночной прогон ~23:30): по задачам за день создаёт кандидатов в `KpiMark` со `status=CANDIDATE` — опоздание (отметка «На месте» позже `timeTo`), не подписан акт (тип с `requiresSignedDoc`, DONE без документа-вложения), не выполнена точка (назначенная на день задача не в DONE/CANCELLED/RESCHEDULED). Идемпотентно (`@@unique([taskId, kind])`), безопасно повторно прогонять. Неоднозначное окно времени (нечитаемый `timeTo`) — пропускаем, Милена добавит вручную. Решение по каждому кандидату — за Миленой, авто-штрафов без подтверждения нет.

## 9. Деплой и эксплуатация

- VPS в РФ (2 vCPU / 2–4 ГБ): Docker Compose — `app` (Next.js standalone), `postgres` (volume `pgdata`), `caddy` (80/443, авто-TLS). Фото — volume `/data/uploads`.
- Бэкапы (cron на VPS): `pg_dump` ежедневно + tar uploads, хранение 14 дней локально + копия наружу (рекомендация: S3-совместимый бакет или хотя бы rsync на второй сервер/диск). Восстановление отрепетировать до пилота.
- Релиз: см. skill deploy-release (миграции → бэкап → up → healthcheck → smoke).
- Env: `DATABASE_URL`, `AUTH_SECRET`, `VAPID_PUBLIC/PRIVATE`, `UPLOADS_DIR`. Секреты — только в `.env` на сервере, в репозитории — `.env.example`.
- Логи: pino в stdout, `docker logs`; событийный журнал доступа — TaskEvent + auth-лог.

## 10. Тестирование

- Unit (Vitest): статусная матрица (все разрешённые/запрещённые переходы), authz-функции, нумерация. KPI (Фаза 1.5): детекторы нарушений (опоздание/акт/точка на граничных данных), прогрессивный расчёт (0 ошибок = полная премия; убавка ниже оклада; итог не ниже 0), идемпотентность детектора.
- e2e (Playwright): сценарий «Милена создала → назначила → водитель принял → выехал → на месте → фото → выполнено»; тесты изоляции (обязательно); требование фото при DONE. KPI: водитель видит только свой расчёт (чужой → 404); водительские ручки KPI не дают подтверждать/настраивать; закрытый месяц не меняется при правке отметок.
- Definition of Done любой фичи — в CLAUDE.md.

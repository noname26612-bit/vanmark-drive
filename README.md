# vanmark-drive

Сервис планирования и учёта задач водителей компании **VanMark** (van-mark.ru — листогибочное оборудование, выездной ремонт). Диспетчер ставит задачи, водители-мастера выполняют — всё живёт в сервисе вместо Telegram-чата: статусы, история, фото-отчёты, изоляция доступа.

## Что внутри

- **Доска диспетчера** (десктоп): «Водители» (колонки по водителям, пулы «Без даты» и «Ближайшие»), «Цех» (задачи сотрудникам), «Все задачи» с фильтрами, карточка задачи с историей и фото.
- **PWA водителя** (Android): «Мои задачи», статусы с гео-меткой, фото-отчёты с камеры.
- **Жёсткая изоляция**: водитель видит и меняет только свои задачи (проверка на сервере; чужая по прямой ссылке → 404).
- **В работе**: push-уведомления и установка PWA (Этап 5), KPI и прогрессивный расчёт зарплаты (Фаза 1.5).

## Стек

Next.js (App Router, TypeScript strict) · PostgreSQL + Prisma · Auth.js (NextAuth v5) · Tailwind CSS · Serwist (PWA) · web-push · Docker Compose + Caddy. Монолит, один деплой на VPS в РФ.

## Документация

| Документ | О чём |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Продукт: роли, типы задач, статусы, экраны, KPI |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Техника: схема Prisma, статусная матрица, API, безопасность |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Этапы и критерии приёмки |
| [CLAUDE.md](CLAUDE.md) | Правила разработки |

## Локальный запуск

```bash
cp .env.example .env        # заполнить секреты (AUTH_SECRET, VAPID, ...)
pnpm install
pnpm db:up                  # PostgreSQL в Docker
pnpm prisma migrate deploy  # применить миграции
pnpm db:seed                # пользователи и типы задач
pnpm dev                    # http://localhost:3000
```

Проверки: `pnpm lint` · `pnpm typecheck` · `pnpm test` (unit, Vitest) · `pnpm e2e` (Playwright).

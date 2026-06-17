# syntax=docker/dockerfile:1
# vanmark-drive — продовый образ (ARCHITECTURE §9, скилл deploy-release).
# Один образ обслуживает рантайм (next start), миграции (prisma migrate deploy) и сид (db:seed) —
# именно так, как описаны команды релиза в скилле deploy-release. Сборка идёт на сервере.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate
WORKDIR /app

# --- deps: зависимости без lifecycle-скриптов (prisma generate сделаем в build, где есть схема) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# --- build: генерация Prisma-клиента + сборка Next ---
FROM base AS build
# NEXT_PUBLIC_* инлайнятся в клиентский бандл на этапе сборки — публичный VAPID-ключ нужен здесь.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Заглушки только для сборки (next build импортирует модули, а prisma.ts требует DATABASE_URL).
# К БД сборка не подключается; реальные значения приходят в рантайме из .env.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV AUTH_SECRET="build-time-placeholder"
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

# --- runtime: тот же полный образ, запускаем next start (cron-инструментация поднимается сама) ---
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
CMD ["pnpm", "start"]

#!/usr/bin/env bash
# Ежедневный бэкап vanmark-drive (скилл deploy-release): дамп БД + архив фото, ротация 14 дней.
# Ставится в cron на сервере (см. deploy/README.md). Имена контейнера/тома фиксированы в
# docker-compose.prod.yml (vanmark-postgres, vanmark_uploads).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PG_USER="${POSTGRES_USER:-vanmark}"
PG_DB="${POSTGRES_DB:-vanmark}"
DATE="$(date +%F)"

mkdir -p "$BACKUP_DIR"

# Дамп БД (custom-формат → удобно для pg_restore --clean при откате).
docker exec vanmark-postgres pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$BACKUP_DIR/db-$DATE.dump"

# Архив фото из тома uploads.
docker run --rm \
  -v vanmark_uploads:/data/uploads:ro \
  -v "$BACKUP_DIR":/backups \
  alpine tar czf "/backups/uploads-$DATE.tgz" -C /data/uploads .

# Ротация: храним 14 дней.
find "$BACKUP_DIR" -name 'db-*.dump' -mtime +14 -delete
find "$BACKUP_DIR" -name 'uploads-*.tgz' -mtime +14 -delete

echo "[backup] готово: $BACKUP_DIR/db-$DATE.dump + uploads-$DATE.tgz"

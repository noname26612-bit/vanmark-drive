#!/usr/bin/env bash
# Ежедневный бэкап vanmark-drive (скилл deploy-release): дамп БД + архив фото, ротация 14 дней,
# и ОПЦИОНАЛЬНАЯ выгрузка зашифрованной копии «наружу» (off-site) — чтобы бэкап пережил потерю
# сервера. Имена контейнера/тома фиксированы в docker-compose.prod.yml (vanmark-postgres,
# vanmark_uploads).
#
# Базовое поведение (без доп. переменных) не изменилось: локальный дамп БД + архив фото + ротация.
#
# OFF-SITE (включается переменными окружения; задаются в cron-строке /etc/cron.d/vanmark-backup):
#   Шифрование (дампы содержат ПДн — наружу только в шифрованном виде):
#     BACKUP_AGE_RECIPIENT=age1...        # публичный ключ age; приватный держит владелец вне сервера
#       (или) BACKUP_GPG_RECIPIENT=<key-id|email>
#   Назначение (одно из):
#     BACKUP_S3_URI=s3://bucket/vanmark   BACKUP_S3_ENDPOINT=https://s3.twcstorage.ru  (+ AWS_* creds, awscli)
#     BACKUP_RCLONE_REMOTE=remote:vanmark  (rclone)
#     BACKUP_REMOTE_CMD='scp -q {} user@host:/backups/'   # {} заменяется на путь файла
#   BACKUP_ALLOW_PLAINTEXT_OFFSITE=true   # разрешить выгрузку БЕЗ шифрования (только для доверённого
#                                          # приёмника); по умолчанию незашифрованный off-site запрещён.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PG_USER="${POSTGRES_USER:-vanmark}"
PG_DB="${POSTGRES_DB:-vanmark}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
DATE="$(date +%F)"

log() { printf '[backup %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

mkdir -p "$BACKUP_DIR"
DB_FILE="$BACKUP_DIR/db-$DATE.dump"
UPLOADS_FILE="$BACKUP_DIR/uploads-$DATE.tgz"

# 1. Дамп БД (custom-формат → удобно для pg_restore --clean при откате).
docker exec vanmark-postgres pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$DB_FILE"
[ -s "$DB_FILE" ] || { log "ОШИБКА: дамп БД пустой ($DB_FILE)"; exit 1; }

# 2. Архив фото из тома uploads.
docker run --rm \
  -v vanmark_uploads:/data/uploads:ro \
  -v "$BACKUP_DIR":/backups \
  alpine tar czf "/backups/uploads-$DATE.tgz" -C /data/uploads .

log "локально: $DB_FILE ($(du -h "$DB_FILE" | cut -f1)) + $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1))"

# --- OFF-SITE (опционально) ---------------------------------------------------------------------
offsite_target_set() { [ -n "${BACKUP_S3_URI:-}${BACKUP_RCLONE_REMOTE:-}${BACKUP_REMOTE_CMD:-}" ]; }

# Шифрует $1 → echo путь к зашифрованному файлу; если шифрование не настроено, echo $1 как есть.
encrypt_if_configured() {
  local src="$1"
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    command -v age >/dev/null 2>&1 || { log "ОШИБКА: BACKUP_AGE_RECIPIENT задан, но age не установлен — off-site пропущен (ПДн не выгружаем в открытом виде)"; return 1; }
    age -r "$BACKUP_AGE_RECIPIENT" -o "${src}.age" "$src" && { echo "${src}.age"; return 0; }
    log "ОШИБКА: age-шифрование не удалось для $src"; return 1
  elif [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
    command -v gpg >/dev/null 2>&1 || { log "ОШИБКА: BACKUP_GPG_RECIPIENT задан, но gpg не установлен — off-site пропущен"; return 1; }
    gpg --yes --batch --trust-model always -r "$BACKUP_GPG_RECIPIENT" -o "${src}.gpg" -e "$src" && { echo "${src}.gpg"; return 0; }
    log "ОШИБКА: gpg-шифрование не удалось для $src"; return 1
  else
    # Шифрование не настроено: выгрузка наружу только при явном разрешении (приёмник доверенный).
    [ "${BACKUP_ALLOW_PLAINTEXT_OFFSITE:-false}" = "true" ] || { log "off-site пропущен: шифрование не настроено (BACKUP_AGE_RECIPIENT/BACKUP_GPG_RECIPIENT), а BACKUP_ALLOW_PLAINTEXT_OFFSITE!=true"; return 1; }
    echo "$src"; return 0
  fi
}

upload_offsite() {
  local file="$1"
  if [ -n "${BACKUP_S3_URI:-}" ]; then
    command -v aws >/dev/null 2>&1 || { log "WARN: BACKUP_S3_URI задан, но awscli нет"; return 1; }
    local ep=(); [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ep=(--endpoint-url "$BACKUP_S3_ENDPOINT")
    aws "${ep[@]}" s3 cp "$file" "${BACKUP_S3_URI%/}/$(basename "$file")" \
      && log "off-site S3 ok: ${BACKUP_S3_URI%/}/$(basename "$file")" || { log "WARN: off-site S3 не удался"; return 1; }
  fi
  if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
    command -v rclone >/dev/null 2>&1 || { log "WARN: BACKUP_RCLONE_REMOTE задан, но rclone нет"; return 1; }
    rclone copy "$file" "$BACKUP_RCLONE_REMOTE" && log "off-site rclone ok: $BACKUP_RCLONE_REMOTE" || { log "WARN: off-site rclone не удался"; return 1; }
  fi
  if [ -n "${BACKUP_REMOTE_CMD:-}" ]; then
    local cmd="${BACKUP_REMOTE_CMD//\{\}/$file}"
    eval "$cmd" && log "off-site custom ok" || { log "WARN: off-site custom не удался"; return 1; }
  fi
}

if offsite_target_set; then
  for f in "$DB_FILE" "$UPLOADS_FILE"; do
    if enc="$(encrypt_if_configured "$f")"; then
      upload_offsite "$enc" || true
      # удаляем временный шифр-файл (локально храним исходники)
      [ "$enc" != "$f" ] && rm -f "$enc"
    fi
  done
else
  log "off-site назначение не задано → бэкап ТОЛЬКО локальный. Для копии наружу задай BACKUP_S3_URI / BACKUP_RCLONE_REMOTE / BACKUP_REMOTE_CMD (+ шифрование BACKUP_AGE_RECIPIENT)."
fi

# --- Ротация: храним RETENTION_DAYS дней (только ежедневные db-/uploads-, ручные дампы не трогаем) ---
find "$BACKUP_DIR" -maxdepth 1 -name 'db-????-??-??.dump' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-????-??-??.tgz' -mtime +"$RETENTION_DAYS" -delete

log "готово. Локальных дампов БД: $(find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' | wc -l | tr -d ' ')"

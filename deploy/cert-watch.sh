#!/usr/bin/env bash
# Одноразовый сторож (Этап 7): ждёт делегирования vmdrive24.ru, дёргает Caddy для выпуска
# сертификата и самоудаляется, когда HTTPS заработал. Ставится cron-ом каждые 10 минут.
set -e
LOG(){ echo "$(date -Is) $*"; }
if curl -sf -m 10 https://vmdrive24.ru/api/health >/dev/null 2>&1; then
  rm -f /etc/cron.d/vanmark-certwatch
  LOG "vmdrive24.ru HTTPS готов — сторож снят."
  exit 0
fi
if getent ahostsv4 vmdrive24.ru 2>/dev/null | grep -q 45.144.222.223; then
  LOG "домен резолвится, рестарт caddy для выпуска сертификата"
  cd /opt/vanmark && docker compose -f docker-compose.prod.yml restart caddy
else
  LOG "делегирование ещё не пришло — ждём"
fi

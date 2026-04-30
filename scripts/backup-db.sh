#!/usr/bin/env bash
# ══════════════════════════════════════════════
# Right Order — Postgres backup + rotation
# ══════════════════════════════════════════════
# Runs pg_dump inside the postgres container, gzips, keeps the last 7 daily
# backups. Cron suggestion:
#   0 3 * * *  cd /root/right-order && ./scripts/backup-db.sh >> /var/log/rightorder-backup.log 2>&1
# ══════════════════════════════════════════════

set -euo pipefail

# Resolve project root from script location (so cron from any CWD works).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"

# Load .env so we know the DB user/name (without exporting password to logs).
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

DB_USER="${POSTGRES_USER:-rightorder}"
DB_NAME="${POSTGRES_DB:-rightorder}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}-${TS}.sql.gz"
TMP="$OUT.partial"

# Pick `docker compose` v2, fall back to legacy `docker-compose`.
if docker compose version &>/dev/null; then
  DC=(docker compose)
elif command -v docker-compose &>/dev/null; then
  DC=(docker-compose)
else
  echo "ERROR: neither 'docker compose' nor 'docker-compose' is installed" >&2
  exit 1
fi

echo "[$(date -u +%FT%TZ)] dumping ${DB_NAME} → ${OUT}"

# pg_dump streams to stdout; gzip on the host so we don't need gzip in the image.
# `-T` disables TTY allocation so this works from cron.
"${DC[@]}" exec -T "$COMPOSE_SERVICE" \
  pg_dump --clean --if-exists --no-owner --no-privileges \
          -U "$DB_USER" -d "$DB_NAME" \
  | gzip -9 > "$TMP"

# Atomic move so a partial dump never looks like a valid backup.
mv "$TMP" "$OUT"
chmod 600 "$OUT"

SIZE=$(du -h "$OUT" | awk '{print $1}')
echo "[$(date -u +%FT%TZ)] backup OK (${SIZE})"

# ── Rotation: keep the most recent $RETAIN_DAYS files for this DB ──
echo "[$(date -u +%FT%TZ)] rotating: keeping last ${RETAIN_DAYS} backups"
# shellcheck disable=SC2012  # ls is fine here, names have a sortable timestamp
ls -1t "$BACKUP_DIR"/"${DB_NAME}"-*.sql.gz 2>/dev/null \
  | tail -n +$((RETAIN_DAYS + 1)) \
  | while read -r old; do
      echo "  removing $old"
      rm -f -- "$old"
    done

echo "[$(date -u +%FT%TZ)] done"

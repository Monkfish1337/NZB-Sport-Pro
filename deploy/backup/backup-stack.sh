#!/usr/bin/env bash

# NZB-Sport-Pro data-volume backup. The .env and SESSION_SECRET are
# deliberately excluded and must be backed up separately.
set -euo pipefail

STACK_DIR="${NZB_STACK_DIR:-/mnt/storage/nzb-sport-pro}"
BACKUP_ROOT="${NZB_BACKUP_ROOT:-/mnt/storage/backups/nzb-sport-pro}"
KEEP_COUNT="${NZB_BACKUP_KEEP_COUNT:-14}"
SERVICE="${NZB_COMPOSE_SERVICE:-nzb-sport-pro}"
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d -t nzb-sport-pro-backup-XXXXXX)"
OUTPUT="${BACKUP_ROOT}/nzb-sport-pro-data-${STAMP}.tar.gz"

cleanup() { rm -rf -- "${STAGE}"; }
trap cleanup EXIT

COMPOSE_FILE=""
for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  if [[ -f "${STACK_DIR}/${candidate}" ]]; then
    COMPOSE_FILE="${candidate}"
    break
  fi
done
if [[ -z "${COMPOSE_FILE}" ]]; then
  echo "ERROR: no Compose file was found in ${STACK_DIR}." >&2
  exit 1
fi

mkdir -p -- "${BACKUP_ROOT}" "${STAGE}/nzb-sport-pro-backup"
chmod 700 "${BACKUP_ROOT}"
cd "${STACK_DIR}"

if ! docker compose config --services | grep -Fxq "${SERVICE}"; then
  echo "ERROR: Compose service ${SERVICE} was not found in ${STACK_DIR}." >&2
  exit 1
fi

DATA_ARCHIVE="${STAGE}/nzb-sport-pro-backup/data.tar.gz"
if docker compose ps --status running --services | grep -Fxq "${SERVICE}"; then
  docker compose exec -T "${SERVICE}" sh -c 'tar -czf - -C /app/data .' > "${DATA_ARCHIVE}"
else
  docker compose run --rm --no-deps -T --entrypoint sh "${SERVICE}" \
    -c 'tar -czf - -C /app/data .' > "${DATA_ARCHIVE}"
fi

tar -tzf "${DATA_ARCHIVE}" >/dev/null
sha256sum "${DATA_ARCHIVE}" > "${STAGE}/nzb-sport-pro-backup/SHA256SUMS"
cat > "${STAGE}/nzb-sport-pro-backup/RESTORE.md" <<RESTORE
# NZB-Sport-Pro data restore

This archive intentionally does not contain \`.env\` or \`SESSION_SECRET\`.
Recover the exact original environment from its separate secret backup first.

1. Extract this outer archive and run \`sha256sum -c SHA256SUMS\`.
2. From the directory with the Compose file and recovered \`.env\`, run
   \`docker compose stop ${SERVICE}\`.
3. Restore only into a new or deliberately emptied data volume:
   \`docker compose run --rm --no-deps -T --entrypoint sh ${SERVICE} -c 'tar -xzf - -C /app/data' < data.tar.gz\`
4. Run \`docker compose up -d ${SERVICE}\`.
5. Verify \`https://YOUR-HOST/health\` reports \`ok: true\` before reopening use.

Do not extract over a running or populated volume. A mismatched SESSION_SECRET
makes encrypted configurations unreadable and \`/health\` return HTTP 503.
RESTORE

tar -czf "${OUTPUT}" -C "${STAGE}" nzb-sport-pro-backup
chmod 600 "${OUTPUT}"

mapfile -t OLD_BACKUPS < <(find "${BACKUP_ROOT}" -maxdepth 1 -type f \
  -name 'nzb-sport-pro-data-*.tar.gz' -printf '%T@ %p\n' | sort -nr | \
  tail -n "+$((KEEP_COUNT + 1))" | cut -d' ' -f2-)
for old in "${OLD_BACKUPS[@]}"; do rm -f -- "${old}"; done

echo "Backup created: ${OUTPUT}"

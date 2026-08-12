#!/usr/bin/env bash
#
# stremio-stack daily backup.
#
# Backs up the small, high-value stuff:
#   - docker-compose.yml + .env (service defs + secrets)
#   - SSS user state (users, custom promotions, settings, encrypted keys, events)
#   - Scraper state (sources, downloaders, grabber, history, logs)
#   - Prowlarr, qBittorrent, AIOStreams, NZBHydra2 configs
#
# Skips the big rebuild-able Postgres databases (zilean/comet/bitmagnet) —
# they repopulate from source over hours/days.
#
# Output: /mnt/storage/backups/stremio-stack/stremio-stack-YYYYMMDD-HHMMSS.tar.gz
# Retention: keeps the newest KEEP_COUNT (default 14) tarballs.
#
# Restore procedure lives in the tarball itself (RESTORE.md at the root of the
# archive) so you don't need this host to be alive to read it.

set -euo pipefail

STACK_DIR="${STACK_DIR:-/mnt/storage/stremio-stack}"
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/storage/backups/stremio-stack}"
KEEP_COUNT="${KEEP_COUNT:-14}"

TS="$(date +%Y%m%d-%H%M%S)"
TMP_DIR="$(mktemp -d -t sss-backup-XXXXXX)"
OUT="${BACKUP_ROOT}/stremio-stack-${TS}.tar.gz"

trap 'rm -rf "${TMP_DIR}"' EXIT

log() { echo "[backup $(date +%H:%M:%S)] $*"; }

if [ ! -d "${STACK_DIR}" ]; then
    echo "ERROR: STACK_DIR=${STACK_DIR} not found" >&2
    exit 1
fi

mkdir -p "${BACKUP_ROOT}"
mkdir -p "${TMP_DIR}/stremio-stack"

log "staging into ${TMP_DIR}"

# ---- compose + secrets (tiny, essential) ----
[ -f "${STACK_DIR}/docker-compose.yml" ] \
    && cp "${STACK_DIR}/docker-compose.yml" "${TMP_DIR}/stremio-stack/"
[ -f "${STACK_DIR}/.env" ] \
    && cp "${STACK_DIR}/.env" "${TMP_DIR}/stremio-stack/"

# ---- SSS user state (CRITICAL — this is what gets wiped on recreate) ----
if [ -d "${STACK_DIR}/serioussportsync-data" ]; then
    cp -a "${STACK_DIR}/serioussportsync-data" "${TMP_DIR}/stremio-stack/"
    log "included serioussportsync-data ($(du -sh "${STACK_DIR}/serioussportsync-data" | cut -f1))"
else
    log "WARN: serioussportsync-data not found — data mount not set up?"
fi

# ---- Scraper state ----
if [ -d "${STACK_DIR}/serioussportsync-scraper/data" ]; then
    mkdir -p "${TMP_DIR}/stremio-stack/serioussportsync-scraper"
    cp -a "${STACK_DIR}/serioussportsync-scraper/data" "${TMP_DIR}/stremio-stack/serioussportsync-scraper/"
    log "included serioussportsync-scraper/data"
fi

# ---- Configs of adjacent services (useful for full-stack rebuild) ----
for svc in prowlarr prowlarr-usenet nzbhydra2 aiostreams bitmagnet; do
    if [ -d "${STACK_DIR}/${svc}/config" ]; then
        mkdir -p "${TMP_DIR}/stremio-stack/${svc}"
        # qBit config includes downloading torrents state — skip 'BT_backup' + 'downloads' subdir
        cp -a "${STACK_DIR}/${svc}/config" "${TMP_DIR}/stremio-stack/${svc}/" 2>/dev/null || true
        log "included ${svc}/config"
    fi
done

# qBittorrent — config only, no BT state
if [ -d "${STACK_DIR}/qbittorrent/config" ]; then
    mkdir -p "${TMP_DIR}/stremio-stack/qbittorrent"
    rsync -a \
        --exclude='BT_backup/' \
        --exclude='downloads/' \
        --exclude='*.log' \
        "${STACK_DIR}/qbittorrent/config/" \
        "${TMP_DIR}/stremio-stack/qbittorrent/config/" 2>/dev/null || \
        cp -a "${STACK_DIR}/qbittorrent/config" "${TMP_DIR}/stremio-stack/qbittorrent/"
    log "included qbittorrent/config (no BT state)"
fi

# ---- Restore procedure — always included at the top level ----
cat > "${TMP_DIR}/stremio-stack/RESTORE.md" <<'RESTORE_INNER'
# stremio-stack restore procedure

If your server disk died and you need to bring SSS + scraper back on a fresh
Debian install:

## Prerequisites
- Fresh Debian with docker + docker compose plugin installed
- The tarball extracted somewhere (e.g. /tmp/restore)

## Steps

1. Recreate the mount + user structure:
   ```bash
   sudo mkdir -p /mnt/storage
   # Mount your storage disk at /mnt/storage per your original setup
   ```

2. Extract the tarball into place:
   ```bash
   sudo tar -xzf stremio-stack-YYYYMMDD-HHMMSS.tar.gz -C /mnt/storage/
   ```
   This puts everything under /mnt/storage/stremio-stack/.

3. Confirm the .env is there:
   ```bash
   sudo test -f /mnt/storage/stremio-stack/.env && echo OK
   ```

4. Recreate the docker network (must match the compose file):
   ```bash
   sudo docker network create stremio-stack_stremio-net 2>/dev/null || true
   ```

5. Bring the stack up:
   ```bash
   cd /mnt/storage/stremio-stack
   sudo docker compose up -d
   ```

6. Wait for containers to build + start (~2-5 min first time — pulls all images,
   rebuilds SSS + scraper from ./serioussportsync/ and ./serioussportsync-scraper/).

7. Verify SSS is alive:
   ```bash
   curl -s http://localhost:7000/manifest.json | head -3
   # Or for the multi-tenant install URL, log in via /account.
   ```

## What you'll need to re-do manually

- If serioussportsync/ source directory ISN'T in this backup (because deploy/
  was excluded), re-extract the latest 0.42.x tarball from your git repo.
- Zilean, comet, bitmagnet Postgres data was NOT backed up (rebuilds itself).
  Expect ~24h of catch-up scrape after first boot.
- Stremio clients (each device) will need the install URL re-added.

## What just works

- SSS users, TorBox/UU keys (encrypted), custom promotions, refreshed events
- Scraper sources (Prowlarr / Knaben / Zilean / TheRARBG / bitsearch /
  Bitmagnet configs), grabber sources, download client credentials
- Prowlarr indexers, NZBHydra2 configs, AIOStreams config
- qBittorrent settings (but not in-flight torrents — those you re-add if needed)
RESTORE_INNER

# ---- Build the tarball ----
log "creating ${OUT}"
tar -czf "${OUT}" -C "${TMP_DIR}" stremio-stack
SIZE=$(du -h "${OUT}" | cut -f1)
log "backup created: ${OUT} (${SIZE})"

# ---- Rotation ----
cd "${BACKUP_ROOT}"
BACKUPS=$(ls -1t stremio-stack-*.tar.gz 2>/dev/null | tail -n +$((KEEP_COUNT + 1)))
if [ -n "${BACKUPS}" ]; then
    log "pruning old backups beyond keep=${KEEP_COUNT}:"
    echo "${BACKUPS}" | while read -r old; do
        log "  - removing ${old}"
        rm -f "${old}"
    done
fi

# ---- Report ----
log "current backups in ${BACKUP_ROOT}:"
ls -lht "${BACKUP_ROOT}"/stremio-stack-*.tar.gz | head -5
log "done"

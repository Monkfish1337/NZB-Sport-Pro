#!/usr/bin/env bash

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="${NZB_STACK_DIR:-$(pwd)}"
BACKUP_ROOT="${NZB_BACKUP_ROOT:-/mnt/storage/backups/nzb-sport-pro}"
KEEP_COUNT="${NZB_BACKUP_KEEP_COUNT:-14}"
SERVICE="${NZB_COMPOSE_SERVICE:-nzb-sport-pro}"

if [[ ! -f "${STACK_DIR}/docker-compose.yml" ]]; then
  echo "ERROR: run from the NZB-Sport-Pro stack directory or set NZB_STACK_DIR." >&2
  exit 1
fi

install -m 0755 "${SOURCE_DIR}/backup-stack.sh" /usr/local/sbin/nzb-sport-pro-backup
install -m 0644 "${SOURCE_DIR}/nzb-sport-pro-backup.service" /etc/systemd/system/
install -m 0644 "${SOURCE_DIR}/nzb-sport-pro-backup.timer" /etc/systemd/system/
install -d -m 0755 /etc/default
{
  printf 'NZB_STACK_DIR=%q\n' "${STACK_DIR}"
  printf 'NZB_BACKUP_ROOT=%q\n' "${BACKUP_ROOT}"
  printf 'NZB_BACKUP_KEEP_COUNT=%q\n' "${KEEP_COUNT}"
  printf 'NZB_COMPOSE_SERVICE=%q\n' "${SERVICE}"
} > /etc/default/nzb-sport-pro-backup
chmod 600 /etc/default/nzb-sport-pro-backup

systemctl daemon-reload
systemctl enable --now nzb-sport-pro-backup.timer

echo "Installed. Run the first backup with:"
echo "  sudo systemctl start nzb-sport-pro-backup.service"
echo "Then inspect:"
echo "  sudo journalctl -u nzb-sport-pro-backup.service --since='10 minutes ago'"
echo "  sudo ls -lht ${BACKUP_ROOT}"

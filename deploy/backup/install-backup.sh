#!/usr/bin/env bash
#
# One-shot installer for the stremio-stack backup systemd timer.
# Assumes you've SCP'd the whole deploy/backup/ directory to /home/monkeh/backup-install/.
#
# Run as root (or via sudo):
#     sudo /home/monkeh/backup-install/install-backup.sh

set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="/mnt/storage/stremio-stack"
SCRIPT_DIR="${STACK_DIR}/scripts"
SYSTEMD_DIR="/etc/systemd/system"

echo "== stremio-stack backup installer =="
echo "  source: ${SRC}"
echo "  script destination: ${SCRIPT_DIR}"
echo "  systemd unit destination: ${SYSTEMD_DIR}"
echo

# Install the script
mkdir -p "${SCRIPT_DIR}"
install -m 0755 "${SRC}/backup-stack.sh" "${SCRIPT_DIR}/backup-stack.sh"
echo "installed ${SCRIPT_DIR}/backup-stack.sh"

# Install systemd units
install -m 0644 "${SRC}/backup-stack.service" "${SYSTEMD_DIR}/backup-stack.service"
install -m 0644 "${SRC}/backup-stack.timer"   "${SYSTEMD_DIR}/backup-stack.timer"
echo "installed ${SYSTEMD_DIR}/backup-stack.{service,timer}"

# Reload + enable + start
systemctl daemon-reload
systemctl enable backup-stack.timer
systemctl start backup-stack.timer
echo
echo "systemd timer enabled + started."
echo
echo "== next steps =="
echo "  1. Verify the timer is armed:"
echo "     systemctl list-timers backup-stack.timer"
echo
echo "  2. Run the backup ONCE now to confirm it works:"
echo "     systemctl start backup-stack.service"
echo "     journalctl -u backup-stack.service --since='5 minutes ago' | tail -30"
echo
echo "  3. Check the backup landed:"
echo "     ls -lht /mnt/storage/backups/stremio-stack/ | head -5"

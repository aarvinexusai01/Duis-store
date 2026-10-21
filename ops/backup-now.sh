#!/usr/bin/env bash
# Takes a backup immediately (doc/07 §6), e.g. before risky maintenance.
#   ops/backup-now.sh            differential database backup
#   ops/backup-now.sh full       full database backup
#   ops/backup-now.sh nightly    database dump and images through restic
#   ops/backup-now.sh status     list what the bucket holds
set -euo pipefail
# shellcheck source=ops/lib.sh
source "$(dirname "$0")/lib.sh"

case "${1:-diff}" in
  full | diff) "$COMPOSE" exec -T backup duis-backup pgbackrest "${1:-diff}" ;;
  nightly | status | prune | check) "$COMPOSE" exec -T backup duis-backup "$1" ;;
  *) die "usage: ops/backup-now.sh [diff|full|nightly|status|prune|check]" ;;
esac

#!/usr/bin/env bash
# Restores the database and/or images from the backup bucket (doc/07 §6;
# runbook: restore). Destructive: it replaces what the server holds now.
#   ops/restore.sh --latest                               newest state in the bucket
#   ops/restore.sh --pitr "2026-10-21 14:05:00+05:30"     a moment in time (IST shown)
#   ops/restore.sh --media [snapshot]                     images (default: latest snapshot)
#   ops/restore.sh --latest --media                       both (a new server)
# Add --yes to skip the confirmation. On a new server, run it before the
# first ops/deploy.sh, which then starts the restored database.
set -euo pipefail

main() {
  # shellcheck source=ops/lib.sh
  source "$(dirname "$0")/lib.sh"
  cd "$DUIS_ROOT"
  local db=false target="" media=false snapshot=latest yes=false
  while [ $# -gt 0 ]; do
    case $1 in
      --latest) db=true ;;
      --pitr) db=true && target=${2:?time missing} && shift ;;
      --media)
        media=true
        if [ -n "${2:-}" ] && [[ $2 != --* ]]; then snapshot=$2 && shift; fi
        ;;
      --yes) yes=true ;;
      *) die "unknown option $1 (see the top of ops/restore.sh)" ;;
    esac
    shift
  done
  $db || $media || die "say what to restore: --latest, --pitr <time> and/or --media"

  printf 'This replaces:\n'
  $db && printf '  - the database, with the backup state at %s\n' "${target:-the newest point}"
  $media && printf '  - the images and private files, with restic snapshot %s\n' "$snapshot"
  if ! $yes; then
    local answer
    read -r -p 'Type "restore" to continue: ' answer
    [ "$answer" = restore ] || die "cancelled"
  fi

  local started apps_running=false
  started=$(date +%s)
  [ -n "$("$COMPOSE" ps -q web_a 2>/dev/null)" ] && apps_running=true
  docker image inspect "duis-postgres:$(git rev-parse --short=12 HEAD:docker/postgres)" >/dev/null 2>&1 ||
    "$COMPOSE" build postgres

  if $apps_running; then
    log "stopping the app and backups"
    "$COMPOSE" stop web_a web_b worker backup
  fi

  if $db; then
    log "stopping postgres"
    "$COMPOSE" stop postgres 2>/dev/null || true
    "$COMPOSE" run --rm --no-deps restore restore-db "$target"
    log "starting postgres; it replays the archived changes, which can take a while"
    "$COMPOSE" up -d --no-deps --no-recreate postgres
    "$COMPOSE" start postgres >/dev/null
    wait_healthy postgres 3600
    until [ "$(psql_super 'select pg_is_in_recovery()')" = f ]; do sleep 5; done
    log "database restored: $(psql_super "select 'orders ' || count(*) || ', newest ' || coalesce(max(created_at)::text, 'none') from orders")"
  fi

  if $media; then
    "$COMPOSE" run --rm --no-deps restore restore-media "$snapshot"
  fi

  if $apps_running; then
    log "starting the app and backups"
    "$COMPOSE" start web_a web_b worker backup
    wait_healthy web_a 180 && wait_healthy web_b 180
    if $db; then
      # A point-in-time restore starts a new history; back it up right away.
      "$DUIS_ROOT/ops/backup-now.sh" full
    fi
    "$DUIS_ROOT/ops/smoke-test.sh"
  else
    log "next: ops/deploy.sh <ref> --skip-backup-check (it starts the restored database)"
  fi
  log "restore finished in $(($(date +%s) - started))s"
}

main "$@"
exit

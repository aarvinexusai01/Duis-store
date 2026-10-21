#!/usr/bin/env bash
# The monthly restore drill (doc/07 §6). Restores the newest backup into a
# throwaway Compose project next to production, then checks it:
#   - the database comes up and every order, customer, product and image
#     record that existed at the restored moment is there;
#   - a sample of 20 images matches production byte for byte;
#   - data loss window (RPO) and restore time (RTO) are measured.
# The result is recorded as the "Monthly restore drill" server check.
#   ops/restore-drill.sh [--keep]    --keep leaves the drill project running
set -euo pipefail

main() {
  # shellcheck source=ops/lib.sh
  source "$(dirname "$0")/lib.sh"
  cd "$DUIS_ROOT"
  local keep=false
  [ "${1:-}" = --keep ] && keep=true

  export APP_SHA=none PG_TAG
  PG_TAG=$(git rev-parse --short=12 HEAD:docker/postgres)
  DRILL=(docker compose --project-name duis-drill --project-directory "$DUIS_ROOT"
    --env-file "$DUIS_ROOT/.env.infra" -f "$DUIS_ROOT/compose.drill.yaml")
  if is_local; then
    DRILL+=(-f "$DUIS_ROOT/compose.drill.local.yaml")
  fi

  # Any exit before the end records a failed drill and cleans up. (An EXIT
  # trap, not ERR: ERR would also fire inside the $(…) polls below.)
  finished=false
  trap on_exit EXIT
  "${DRILL[@]}" down -v --remove-orphans >/dev/null 2>&1 || true

  local t0 t_db t_done
  t0=$(date +%s)
  log "drill: restoring the newest database backup"
  "${DRILL[@]}" run --rm --no-deps restore restore-db
  "${DRILL[@]}" up -d --no-deps postgres
  local waited=0
  until [ "$(drill_sql 'select pg_is_in_recovery()' 2>/dev/null)" = f ]; do
    sleep 3
    waited=$((waited + 3))
    [ "$waited" -lt 3600 ] || die "the drill database did not finish recovery in an hour"
  done
  t_db=$(date +%s)

  log "drill: restoring the newest images"
  "${DRILL[@]}" run --rm --no-deps restore restore-media latest >/dev/null
  t_done=$(date +%s)

  log "drill: checking the restored data"
  # The newest moment the restored database knows about: the worker
  # completes a heartbeat job every minute.
  local restored_at rpo
  restored_at=$(drill_sql "select to_char(max(completed_on) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from pgboss.job")
  [ -n "$restored_at" ] || die "the restored database has no job history"
  rpo=$(($(date +%s) - $(date_to_epoch "$restored_at")))

  local table mismatches=() counted=0
  for table in orders order_items payments users products media_assets; do
    local query="select count(*) from $table where created_at <= '$restored_at'"
    local prod drill
    prod=$(psql_super "$query")
    drill=$(drill_sql "$query")
    counted=$((counted + 1))
    [ "$prod" = "$drill" ] || mismatches+=("$table: production $prod, restored $drill")
  done

  local sample checked=0 differing=0 file
  sample=$("${DRILL[@]}" run --rm --no-deps --entrypoint sh restore -c \
    'find /data/media -type f | shuf -n 20 | xargs -r sha256sum' 2>/dev/null)
  while read -r sum file; do
    [ -n "$file" ] || continue
    checked=$((checked + 1))
    local live
    # </dev/null: exec would otherwise swallow the rest of the list.
    live=$("$COMPOSE" exec -T backup sha256sum "$file" </dev/null 2>/dev/null | awk '{print $1}') || true
    [ "$live" = "$sum" ] || differing=$((differing + 1))
  done <<<"$sample"

  local rto=$((t_done - t0)) db_time=$((t_db - t0)) detail
  detail="Restored in $(minutes $rto) (database $(minutes $db_time)); data loss window $(minutes $rpo); $counted tables checked; $((checked - differing))/$checked images match."
  if [ ${#mismatches[@]} -gt 0 ] || [ "$differing" -gt 0 ]; then
    detail="$detail Mismatches: ${mismatches[*]:-none}."
    record_drill false "$detail"
    finished=true
    cleanup
    die "drill found differences: $detail"
  fi
  record_drill true "$detail"
  finished=true
  log "drill passed: $detail"
  cleanup
}

drill_sql() {
  "${DRILL[@]}" exec -T postgres psql -X -q -U postgres -d duis -At -c "$1"
}

date_to_epoch() {
  date -u -d "$1" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%S' "${1%%.*}" +%s
}

minutes() {
  local s=$1
  if [ "$s" -lt 120 ]; then echo "${s}s"; else echo "$((s / 60))m"; fi
}

record_drill() {
  local ok=$1 detail=$2
  "$COMPOSE" exec -T postgres psql -X -q -U postgres -d duis -v ON_ERROR_STOP=1 \
    -v ok="$ok" -v detail="$detail" >/dev/null <<'SQL'
insert into ops_checks (key, ok, detail, checked_at, last_ok_at)
values ('backup.drill', :'ok'::boolean, :'detail', now(), case when :'ok'::boolean then now() end)
on conflict (key) do update set ok = excluded.ok, detail = excluded.detail,
  checked_at = excluded.checked_at, last_ok_at = coalesce(excluded.last_ok_at, ops_checks.last_ok_at);
SQL
}

cleanup() {
  if $keep; then
    log "drill project left running: docker compose -p duis-drill ps"
  else
    "${DRILL[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}

# shellcheck disable=SC2329 # called by the EXIT trap
on_exit() {
  local code=$?
  $finished && return
  record_drill false "The drill stopped before finishing. Run ops/restore-drill.sh by hand to see why." || true
  cleanup
  log "restore drill failed (exit $code)"
}

main "$@"
exit

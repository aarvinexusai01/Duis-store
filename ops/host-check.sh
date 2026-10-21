#!/usr/bin/env bash
# Server checks that only the host can see (doc/07 §7): disk, memory,
# containers and the origin certificate. Each result becomes a row in
# ops_checks; the worker emails ops when one fails, and /api/health/ops
# turns red for the uptime monitor. Runs every 15 minutes from a systemd
# timer (ops/install-timers.sh).
set -euo pipefail

main() {
  # shellcheck source=ops/lib.sh
  source "$(dirname "$0")/lib.sh"
  cd "$DUIS_ROOT"

  # Disk: the root filesystem and Docker's data (volumes, images).
  local worst=0 worst_path=/ path used
  for path in / /var/lib/docker; do
    [ -d "$path" ] || continue
    used=$(df -P "$path" | awk 'NR==2 {gsub("%", "", $5); print $5}')
    if [ "$used" -gt "$worst" ]; then worst=$used worst_path=$path; fi
  done
  if [ "$worst" -ge 80 ]; then
    report host.disk false "Disk ${worst}% full ($worst_path). Runbook: incident, disk."
  else
    report host.disk true "Disk ${worst}% used."
  fi

  # Memory: little left for the page cache, or heavy swapping.
  if [ -r /proc/meminfo ]; then
    local total avail swap_total swap_free
    total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
    avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
    swap_total=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
    swap_free=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
    local avail_pct=$((avail * 100 / total)) swap_pct=0
    [ "$swap_total" -gt 0 ] && swap_pct=$(((swap_total - swap_free) * 100 / swap_total))
    if [ "$avail_pct" -lt 10 ] || [ "$swap_pct" -gt 50 ]; then
      report host.memory false "Only ${avail_pct}% of memory free, ${swap_pct}% of swap in use."
    else
      report host.memory true "${avail_pct}% of memory free, ${swap_pct}% of swap in use."
    fi
  else
    report host.memory true "Not measured on this machine."
  fi

  # Containers: every long-running service up and healthy, and none
  # restarting on its own since the last check.
  local service problems=() id state restarts previous
  local restarts_file="$STATE_DIR/container-restarts"
  touch "$restarts_file"
  for service in nginx "${WEB_SERVICES[@]}" worker postgres backup; do
    id=$("$COMPOSE" ps -q "$service" 2>/dev/null || true)
    if [ -z "$id" ]; then
      problems+=("$service is not running")
      continue
    fi
    state=$(container_health "$service")
    case $state in
      healthy | running) ;;
      *) problems+=("$service is $state") ;;
    esac
    restarts=$(docker inspect -f '{{.RestartCount}}' "$id")
    previous=$(awk -v id="$id" '$1 == id {print $2}' "$restarts_file")
    if [ -n "$previous" ] && [ "$restarts" -gt "$previous" ]; then
      problems+=("$service restarted $((restarts - previous)) time(s)")
    fi
    { grep -v "^$id " "$restarts_file" || true; echo "$id $restarts"; } >"$restarts_file.new"
    mv "$restarts_file.new" "$restarts_file"
  done
  if [ ${#problems[@]} -gt 0 ]; then
    local joined
    joined=$(printf '%s; ' "${problems[@]}")
    report host.containers false "${joined%; }. See: ops/compose ps."
  else
    report host.containers true "All containers healthy."
  fi

  # Origin certificate (Cloudflare Origin CA, up to 15 years).
  local cert="$STATE_DIR/nginx/origin.pem" end days
  if [ -f "$cert" ]; then
    end=$(openssl x509 -enddate -noout -in "$cert" | cut -d= -f2)
    days=$((($(date_to_epoch "$end") - $(date +%s)) / 86400))
    if [ "$days" -lt 30 ]; then
      report host.certificate false "The origin certificate expires in $days days. Runbook: secret-rotation."
    else
      report host.certificate true "Valid for $days more days."
    fi
  else
    report host.certificate false "No origin certificate at state/nginx/origin.pem."
  fi
}

date_to_epoch() {
  date -u -d "$1" +%s 2>/dev/null || date -u -j -f '%b %e %T %Y %Z' "$1" +%s
}

report() {
  local key=$1 ok=$2 detail=$3
  "$COMPOSE" exec -T postgres psql -X -q -U postgres -d duis -v ON_ERROR_STOP=1 \
    -v key="$key" -v ok="$ok" -v detail="$detail" >/dev/null <<'SQL'
insert into ops_checks (key, ok, detail, checked_at, last_ok_at)
values (:'key', :'ok'::boolean, :'detail', now(), case when :'ok'::boolean then now() end)
on conflict (key) do update set ok = excluded.ok, detail = excluded.detail,
  checked_at = excluded.checked_at, last_ok_at = coalesce(excluded.last_ok_at, ops_checks.last_ok_at);
SQL
  [ "$ok" = true ] || log "$key: $detail"
}

main "$@"
exit

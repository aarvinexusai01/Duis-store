# Shared helpers for the ops scripts. Sourced, not run.
# shellcheck shell=bash

DUIS_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STATE_DIR="$DUIS_ROOT/state"
COMPOSE="$DUIS_ROOT/ops/compose"
# Web replicas, in the order deploys replace them (runbook: add-replica).
# shellcheck disable=SC2034 # used by the scripts that source this file
WEB_SERVICES=(web_a web_b)

log() { printf '\033[1m%s\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# Reads KEY from an env file without sourcing it (values may hold < > and quotes).
env_get() {
  local key=$1 file=$2 line
  line=$(grep -E "^${key}=" "$file" | tail -n 1) || return 0
  line=${line#*=}
  line=${line%\"}
  line=${line#\"}
  printf '%s' "$line"
}

is_local() { [ "$(env_get DUIS_STACK "$DUIS_ROOT/.env.infra")" = local ]; }

# Runs SQL as the superuser through the socket; prints unaligned rows.
psql_super() {
  "$COMPOSE" exec -T postgres psql -X -q -U postgres -d duis -v ON_ERROR_STOP=1 -At -c "$1"
}

container_health() {
  local id
  id=$("$COMPOSE" ps -q "$1" 2>/dev/null) || true
  [ -n "$id" ] || {
    echo missing
    return
  }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id"
}

wait_healthy() {
  local service=$1 timeout=${2:-180} waited=0 status
  while :; do
    status=$(container_health "$service")
    [ "$status" = healthy ] && return 0
    [ "$waited" -ge "$timeout" ] && {
      log "$service is $status after ${timeout}s"
      return 1
    }
    sleep 2
    waited=$((waited + 2))
  done
}

# Asks a web replica, from inside its container, whether it is ready.
replica_ready() {
  "$COMPOSE" exec -T "$1" node -e \
    "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" \
    >/dev/null 2>&1
}

# Writes Nginx's generated files (docker/nginx/nginx.conf includes them):
# the upstream list, with the replicas named in $1 marked `down`, and HSTS.
write_nginx_state() {
  local down=" ${1:-} " svc flags hsts
  mkdir -p "$STATE_DIR/nginx"
  # Nginx reads these as uid 101 inside its container: the folders must be
  # passable (the private key keeps its own 640, group 101).
  chmod 755 "$STATE_DIR" "$STATE_DIR/nginx"
  {
    echo "# Written by ops/lib.sh (write_nginx_state). Do not edit."
    echo "upstream duis_web {"
    echo "    zone duis_web 64k;"
    for svc in "${WEB_SERVICES[@]}"; do
      # Three errors in 10 s before a replica is skipped: with the other one
      # marked down during a deploy, one stray error must not leave no
      # upstream at all.
      flags="resolve max_fails=3 fail_timeout=10s"
      [[ $down == *" $svc "* ]] && flags="$flags down"
      echo "    server $svc:3000 $flags;"
    done
    echo "    keepalive 32;"
    # Below Node's 5 s keep-alive, so Nginx never reuses a connection the
    # replica is closing (that race shows up as 502s).
    echo "    keepalive_timeout 4s;"
    echo "}"
  } >"$STATE_DIR/nginx/upstream.conf.new"
  mv "$STATE_DIR/nginx/upstream.conf.new" "$STATE_DIR/nginx/upstream.conf"
  hsts=$(env_get HSTS_MAX_AGE "$DUIS_ROOT/.env.infra")
  echo "add_header Strict-Transport-Security \"max-age=${hsts:-300}\" always;" \
    >"$STATE_DIR/nginx/hsts.conf"
}

# Checks and applies Nginx's configuration without dropping connections:
# new workers take new requests, old ones finish what they hold.
nginx_reload() {
  [ -n "$("$COMPOSE" ps -q nginx 2>/dev/null)" ] || return 0
  "$COMPOSE" exec -T nginx nginx -c /etc/nginx/duis/nginx.conf -t -q ||
    die "the Nginx configuration is invalid; nothing was reloaded"
  "$COMPOSE" exec -T nginx nginx -c /etc/nginx/duis/nginx.conf -s reload
  # Wait until the old workers have finished their requests (at most 30 s).
  local tries=0
  while "$COMPOSE" exec -T nginx ps -o args 2>/dev/null | grep -q "shutting down"; do
    tries=$((tries + 1))
    [ "$tries" -ge 30 ] && break
    sleep 1
  done
}

# Replaces one web replica with APP_SHA's image without failing a request
# (doc/07 §4): Nginx stops sending it new requests and lets the running ones
# finish, the new container starts and passes its readiness check, then
# Nginx sends it traffic again.
roll_web() {
  local service=$1 sha=$2
  if [ -n "$("$COMPOSE" ps -q "$service" 2>/dev/null)" ]; then
    log "$service: taking it out of rotation"
    write_nginx_state "$service"
    nginx_reload
  fi
  log "$service: starting $sha"
  APP_SHA=$sha "$COMPOSE" up -d --no-deps "$service"
  wait_healthy "$service" 180 || return 1
  local tries=0
  until replica_ready "$service"; do
    tries=$((tries + 1))
    [ "$tries" -ge 60 ] && return 1
    sleep 1
  done
  write_nginx_state
  nginx_reload
  log "$service: back in rotation"
}

roll_worker() {
  log "worker: starting $1"
  APP_SHA=$1 "$COMPOSE" up -d --no-deps worker
  wait_healthy worker 180
}

record_deploy() {
  local action=$1 ref=$2 sha=$3
  mkdir -p "$STATE_DIR"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$action" "$ref" "$sha" "${SUDO_USER:-$USER}" \
    >>"$STATE_DIR/deployments.log"
  printf '%s\n' "$sha" >"$STATE_DIR/deployed_sha"
}

#!/usr/bin/env bash
# Deploys a git ref with no downtime (doc/07 §4). Run as the deploy user
# from the server's checkout (/srv/duis):
#   ops/deploy.sh v1.4.0            a tag, branch or commit
#   ops/deploy.sh main --skip-backup-check
#
# 1. Pre-flight: clean checkout, env files, disk space, a backup from the
#    last 26 hours (taken now if missing).
# 2. Check out the ref and build duis-web:<sha> (skipped if it exists).
# 3. Migrate. If that fails nothing else changes.
# 4. Replace web_a, then web_b, then the worker, one at a time.
# 5. Smoke test, record the deploy, keep the last five images.
set -euo pipefail

main() {
  # shellcheck source=ops/lib.sh
  source "$(dirname "$0")/lib.sh"
  local ref=${1:-} skip_backup_check=false
  [ -n "$ref" ] || die "usage: ops/deploy.sh <git-ref> [--skip-backup-check]"
  [ "${2:-}" = --skip-backup-check ] && skip_backup_check=true
  cd "$DUIS_ROOT"
  local started
  started=$(date +%s)

  log "pre-flight"
  [ -z "$(git status --porcelain --untracked-files=no)" ] ||
    die "the checkout has local changes; deploys use committed code only"
  for file in .env.infra .env.production; do
    [ -f "$file" ] || die "missing $file (see ops/env/)"
    [ "$(stat -c %a "$file" 2>/dev/null || stat -f %Lp "$file")" = 600 ] ||
      die "$file must be chmod 600"
  done
  [ -f state/nginx/origin.pem ] && [ -f state/nginx/origin.key ] && [ -f state/nginx/cloudflare-ips.conf ] ||
    die "state/nginx is incomplete (runbook: first-server-setup)"
  local used
  used=$(df -P "$DUIS_ROOT" | awk 'NR==2 {gsub("%", "", $5); print $5}')
  # Over 85% full leaves too little room for the build (doc/07 §4).
  [ "$used" -lt "${DEPLOY_DISK_LIMIT:-85}" ] || die "disk is ${used}% full; free space before deploying"

  local postgres_running=false
  [ "$(container_health postgres)" = healthy ] && postgres_running=true
  if $postgres_running && ! $skip_backup_check; then
    local hours
    hours=$(psql_super "select coalesce(floor(extract(epoch from now() - last_ok_at) / 3600), 999)
      from ops_checks where key = 'backup.pgbackrest'" 2>/dev/null || true)
    if [ "${hours:-999}" -ge 26 ]; then
      if [ -n "$("$COMPOSE" ps -q backup 2>/dev/null)" ]; then
        log "no database backup in the last 26 hours: taking one now"
        "$DUIS_ROOT/ops/backup-now.sh" diff
      else
        # A first deploy that stopped before starting the backup service:
        # nothing to protect yet, and this deploy starts it.
        log "no backup service yet (first deploy): skipping the pre-deploy backup"
      fi
    fi
  fi

  log "checking out $ref"
  if git remote get-url origin >/dev/null 2>&1 && [ -z "${DUIS_NO_FETCH:-}" ]; then
    git fetch --tags --force origin
  fi
  git checkout --quiet --detach "$ref"
  local sha previous
  sha=$(git rev-parse --short=12 HEAD)
  previous=$(cat state/deployed_sha 2>/dev/null || true)
  export PG_TAG
  PG_TAG=$(git rev-parse --short=12 HEAD:docker/postgres)

  if docker image inspect "duis-web:$sha" >/dev/null 2>&1; then
    log "image duis-web:$sha already built"
  else
    log "building duis-web:$sha"
    ensure_builder
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(env_get NEXT_SERVER_ACTIONS_ENCRYPTION_KEY .env.infra) \
      docker buildx build --builder duis-builder --load \
      --build-arg "APP_SHA=$sha" \
      --build-arg "APP_ENV=$(env_get APP_ENV .env.infra)" \
      --build-arg "NEXT_PUBLIC_SENTRY_DSN=$(env_get NEXT_PUBLIC_SENTRY_DSN .env.infra)" \
      --secret id=next_server_actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
      --tag "duis-web:$sha" .
  fi
  if ! docker image inspect "duis-postgres:$PG_TAG" >/dev/null 2>&1; then
    log "building duis-postgres:$PG_TAG"
    nice -n 10 "$COMPOSE" build postgres
  fi

  # First deploy: create the infrastructure. Later deploys leave a running
  # Postgres and Nginx alone, even if their images changed (restart them in a
  # quiet moment: runbook: deploy).
  write_nginx_state
  local infra=(postgres redis elasticsearch nginx)
  # The laptop stack's stand-ins for R2 and the SMTP provider.
  is_local && infra+=(s3 mailpit)
  APP_SHA=$sha "$COMPOSE" up -d --no-recreate "${infra[@]}"
  wait_healthy postgres 300
  # The app runs without the cache (slower), so this doesn't stop a deploy.
  wait_healthy redis 60 || log "warning: redis is not healthy; the app falls back to Postgres"
  wait_healthy elasticsearch 180 || log "warning: elasticsearch is not healthy; search falls back to Postgres"
  local running_pg
  running_pg=$(docker inspect -f '{{.Config.Image}}' "$("$COMPOSE" ps -q postgres)")
  [ "$running_pg" = "duis-postgres:$PG_TAG" ] ||
    log "note: Postgres runs $running_pg; this release ships duis-postgres:$PG_TAG"

  log "migrating"
  APP_SHA=$sha "$COMPOSE" run --rm migrate || die "migration failed; nothing else was changed"

  local svc
  for svc in "${WEB_SERVICES[@]}"; do
    roll_web "$svc" "$sha" || rollback_and_die "$svc" "$previous"
  done
  roll_worker "$sha" || die "the worker did not become healthy (ops/compose logs worker)"
  # Backups may need the new schema (ops_checks); recreate if its image changed.
  "$COMPOSE" up -d --no-deps backup
  # Picks up nginx.conf changes from this release without dropping connections.
  nginx_reload

  record_deploy deploy "$ref" "$sha"
  "$DUIS_ROOT/ops/smoke-test.sh" --expect-sha "$sha" || die "smoke test failed (consider ops/rollback.sh)"

  prune_images "$sha" "$previous"
  log "deployed $sha ($ref) in $(($(date +%s) - started))s"
}

# Builds run in their own BuildKit container, so they can be held back:
# `nice` on this script wouldn't reach them (BuildKit runs inside Docker).
# Low CPU shares give live traffic priority whenever both want the CPU; the
# memory cap keeps a build from pushing the replicas into swap. Change the
# limits with BUILD_CPU_SHARES / BUILD_MEMORY in .env.infra, then remove the
# builder (docker buildx rm duis-builder) so the next deploy recreates it.
ensure_builder() {
  docker buildx inspect duis-builder >/dev/null 2>&1 && return
  local shares memory
  shares=$(env_get BUILD_CPU_SHARES .env.infra)
  memory=$(env_get BUILD_MEMORY .env.infra)
  docker buildx create --name duis-builder --driver docker-container \
    --driver-opt "cpu-shares=${shares:-128}" --driver-opt "memory=${memory:-4g}" >/dev/null
  log "created the duis-builder build container (cpu-shares ${shares:-128}, memory ${memory:-4g})"
}

rollback_and_die() {
  local service=$1 previous=$2
  if [ -n "$previous" ] && docker image inspect "duis-web:$previous" >/dev/null 2>&1; then
    log "$service failed to start; putting $previous back"
    for svc in "${WEB_SERVICES[@]}"; do roll_web "$svc" "$previous" || true; done
  fi
  die "$service did not become ready (ops/compose logs $service)"
}

# Removes builds this script deployed earlier, keeping the five most recent
# plus whatever runs now. Images it didn't deploy are never touched.
prune_images() {
  local log="$STATE_DIR/deployments.log" keep tag
  keep=$(awk -F'\t' '{ shas[NR] = $4 } END { for (i = NR; i > 0; i--) if (!seen[shas[i]]++) print shas[i] }' \
    "$log" | head -n 5)
  while read -r tag; do
    grep -qx "$tag" <<<"$keep"$'\n'"$1"$'\n'"$2" && continue
    docker image inspect "duis-web:$tag" >/dev/null 2>&1 || continue
    docker image rm "duis-web:$tag" >/dev/null 2>&1 && log "removed old image duis-web:$tag"
  done < <(cut -f4 "$log" | sort -u)
  return 0
}

main "$@"
exit

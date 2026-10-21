#!/usr/bin/env bash
# Puts a previously deployed build back (doc/07 §4): no rebuild and no
# migration (migrations are expand/contract, so the old build works with the
# new schema). Target: under 2 minutes.
#   ops/rollback.sh          the build before the current one
#   ops/rollback.sh <sha>    a specific build from state/deployments.log
set -euo pipefail

main() {
  # shellcheck source=ops/lib.sh
  source "$(dirname "$0")/lib.sh"
  cd "$DUIS_ROOT"
  local started current target
  started=$(date +%s)
  current=$(cat "$STATE_DIR/deployed_sha" 2>/dev/null || true)
  target=${1:-}
  if [ -z "$target" ]; then
    target=$(awk -F'\t' -v cur="$current" '$4 != cur { last = $4 } END { print last }' \
      "$STATE_DIR/deployments.log" 2>/dev/null || true)
  fi
  [ -n "$target" ] || die "no earlier build in state/deployments.log"
  [ "$target" != "$current" ] || die "$target is already deployed"
  docker image inspect "duis-web:$target" >/dev/null 2>&1 ||
    die "image duis-web:$target is gone; deploy that ref instead (ops/deploy.sh <ref>)"

  log "rolling back from ${current:-nothing} to $target"
  local svc
  for svc in "${WEB_SERVICES[@]}"; do
    roll_web "$svc" "$target" || die "$svc did not become ready on $target"
  done
  roll_worker "$target" || die "the worker did not become healthy on $target"
  record_deploy rollback "$target" "$target"
  # The scripts and nginx.conf stay at the newer checkout; only the app changes.
  "$DUIS_ROOT/ops/smoke-test.sh" --expect-sha "$target"
  log "rolled back to $target in $(($(date +%s) - started))s"
}

main "$@"
exit

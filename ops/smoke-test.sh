#!/usr/bin/env bash
# Checks a running deployment through Nginx (doc/07 §4, step 6). By default
# it talks to this server's own Nginx (so it works before DNS points here);
# --public goes through Cloudflare instead.
#   ops/smoke-test.sh [--expect-sha <sha>] [--public]
set -euo pipefail

main() {
  # shellcheck source=ops/lib.sh
  source "$(dirname "$0")/lib.sh"
  local expect_sha="" public=false
  while [ $# -gt 0 ]; do
    case $1 in
      --expect-sha) expect_sha=$2 && shift ;;
      --public) public=true ;;
      *) die "unknown option $1" ;;
    esac
    shift
  done

  local app_url host bind port
  app_url=$(env_get APP_URL "$DUIS_ROOT/.env.production")
  host=$(sed -E 's#^https?://([^/:]+).*#\1#' <<<"$app_url")
  bind=$(env_get HTTPS_BIND "$DUIS_ROOT/.env.infra")
  port=${bind##*:}
  port=${port:-443}

  CURL=(curl -sS --max-time 20)
  BASE="https://$host"
  if ! $public; then
    # The origin certificate is only trusted by Cloudflare, hence -k.
    CURL+=(-k --resolve "$host:$port:127.0.0.1")
    BASE="https://$host:$port"
  fi

  local failures=0
  check() {
    local name=$1 expected=$2 actual=$3
    if [[ $actual =~ ^($expected)$ ]]; then
      printf '  ok    %s\n' "$name"
    else
      printf '  FAIL  %s (got %s, expected %s)\n' "$name" "$actual" "$expected"
      failures=$((failures + 1))
    fi
  }
  status() {
    local code
    code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$@" 2>/dev/null) || true
    echo "${code:-000}"
  }
  body() { "${CURL[@]}" "$@" 2>/dev/null || true; }

  log "smoke test against $BASE"
  check "liveness" 200 "$(status "$BASE/api/health")"
  check "readiness" 200 "$(status "$BASE/api/health/ready")"

  if [ -n "$expect_sha" ]; then
    # Round-robin: several requests cover both replicas.
    local versions
    versions=$(for _ in 1 2 3 4 5 6; do
      body "$BASE/api/health/ready" | sed -E 's/.*"version":"([^"]*)".*/\1/'
      echo
    done | sort -u | tr '\n' ' ')
    check "every replica runs $expect_sha" "$expect_sha " "$versions"
  fi

  local headers
  headers=$("${CURL[@]}" -o /dev/null -D - "$BASE/" 2>/dev/null || true)
  check "home page" 200 "$(awk 'NR==1 {print $2}' <<<"$headers")"
  check "HSTS header" 1 "$(grep -ci '^strict-transport-security:' <<<"$headers" || true)"
  check "CSP header" 1 "$(grep -ci '^content-security-policy:' <<<"$headers" || true)"

  local product
  product=$(body "$BASE/sitemap.xml" | grep -oE "<loc>[^<]*/products/[^<]+</loc>" | head -n 1 |
    sed -E 's#<loc>https?://[^/]+(/[^<]+)</loc>#\1#' || true)
  if [ -n "$product" ]; then
    check "product page $product" 200 "$(status "$BASE$product")"
    local image
    image=$(body "$BASE$product" | grep -oE '/media/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+\.webp' | head -n 1 || true)
    [ -n "$image" ] && check "image from the media volume" 200 "$(status "$BASE$image")"
  else
    printf '  skip  product page (no products in the sitemap yet)\n'
  fi

  check "internal API blocked" 404 "$(status "$BASE/api/internal/revalidate")"
  check "payment webhook rejects a bad signature" 401 \
    "$(status -X POST -H 'content-type: application/json' -H 'x-razorpay-signature: invalid' \
      --data '{"event":"smoke.test"}' "$BASE/api/webhooks/razorpay")"

  [ "$failures" -eq 0 ] || die "$failures smoke check(s) failed"
  log "smoke test passed"
}

main "$@"
exit

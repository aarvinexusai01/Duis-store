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
  # Nginx's page-cache verdict (ADR-0033); "none" when it doesn't apply.
  cache_status() {
    local value
    value=$("${CURL[@]}" -o /dev/null -D - "$@" 2>/dev/null |
      awk 'tolower($1) == "x-cache-status:" { print $2 }' | tr -d '\r') || true
    echo "${value:-none}"
  }

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
    # Product images: on ImageKit (Phase 10) or the local media volume.
    local page image
    page=$(body "$BASE$product")
    image=$(grep -oE 'https://ik\.imagekit\.io/[A-Za-z0-9_-]+/duis/[a-f0-9]{32}/clean\.webp\?tr=w-[0-9]+' <<<"$page" | head -n 1 || true)
    if [ -n "$image" ]; then
      check "product image from ImageKit" 200 "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$image" 2>/dev/null || echo 000)"
      local hex
      hex=$(sed -E 's#.*/duis/([a-f0-9]{32})/.*#\1#' <<<"$image")
      check "no clean original on the server" 404 "$(status "$BASE/media/$hex/orig.webp")"
    else
      image=$(grep -oE '/media/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+\.webp' <<<"$page" | head -n 1 || true)
      [ -n "$image" ] && check "image from the media volume" 200 "$(status "$BASE$image")"
    fi
    check "moved originals are never served" 404 "$(status "$BASE/media/.moved/x/orig.webp")"
    # The 10-second page cache: stored for signed-out visitors with no bag,
    # skipped for anyone with one.
    cache_status "$BASE$product" >/dev/null
    check "page cache serves a product page" "HIT|STALE|UPDATING" "$(cache_status "$BASE$product")"
    check "page cache skipped with a bag" BYPASS \
      "$(cache_status -H 'Cookie: duis_cart=smoke-test' "$BASE$product")"
  else
    printf '  skip  product page (no products in the sitemap yet)\n'
  fi

  check "the bag is never cached" none "$(cache_status "$BASE/cart")"
  check "search" 200 "$(status "$BASE/search?q=shirt")"

  check "internal API blocked" 404 "$(status "$BASE/api/internal/revalidate")"
  check "payment webhook rejects a bad signature" 401 \
    "$(status -X POST -H 'content-type: application/json' -H 'x-razorpay-signature: invalid' \
      --data '{"event":"smoke.test"}' "$BASE/api/webhooks/razorpay")"

  [ "$failures" -eq 0 ] || die "$failures smoke check(s) failed"
  log "smoke test passed"
}

main "$@"
exit

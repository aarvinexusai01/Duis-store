#!/usr/bin/env bash
# Rewrites Nginx's generated files (upstream list, HSTS) and reloads it
# without dropping connections. Use after replacing the origin certificate
# or changing HSTS_MAX_AGE in .env.infra.
set -euo pipefail
# shellcheck source=ops/lib.sh
source "$(dirname "$0")/lib.sh"
write_nginx_state
nginx_reload
log "Nginx reloaded"

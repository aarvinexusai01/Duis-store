#!/usr/bin/env bash
# Refreshes Cloudflare's address ranges (doc/07 §5) in two places:
#   - Nginx's trusted proxies (state/nginx/cloudflare-ips.conf), so the
#     visitor IP is read from CF-Connecting-IP only on Cloudflare connections;
#   - the firewall (run as root), so port 443 accepts only Cloudflare.
# Runs monthly from a systemd timer (ops/install-timers.sh).
#   sudo ops/update-cloudflare-ips.sh
#   ops/update-cloudflare-ips.sh --nginx-only     (no root needed)
set -euo pipefail

main() {
  # shellcheck source=ops/lib.sh
  source "$(dirname "$0")/lib.sh"
  local nginx_only=false
  [ "${1:-}" = --nginx-only ] && nginx_only=true

  local v4 v6
  v4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)
  v6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)
  # Refuse anything that doesn't look like a list of ranges.
  grep -qvE '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' <<<"$v4" && die "unexpected IPv4 list"
  grep -qvE '^[0-9a-f:]+/[0-9]{1,3}$' <<<"$v6" && die "unexpected IPv6 list"
  [ "$(wc -l <<<"$v4")" -ge 10 ] || die "IPv4 list is too short"

  mkdir -p "$STATE_DIR/nginx"
  {
    echo "# Cloudflare ranges, written by ops/update-cloudflare-ips.sh on $(date -u +%F)."
    printf '%s\n%s\n' "$v4" "$v6" | sed 's/.*/set_real_ip_from &;/'
  } >"$STATE_DIR/nginx/cloudflare-ips.conf.new"
  mv "$STATE_DIR/nginx/cloudflare-ips.conf.new" "$STATE_DIR/nginx/cloudflare-ips.conf"
  log "Nginx trusted proxies updated"
  nginx_reload
  $nginx_only && return

  [ "$(id -u)" = 0 ] || die "run as root for the firewall part (or pass --nginx-only)"
  # Docker publishes ports past ufw's INPUT rules, so the port is allowed per
  # source range in the forward chain (see ops/bootstrap.sh, "ufw and Docker").
  # Docker has already rewritten the destination to the container's port by
  # then: the rule must name Nginx's 8443, not the public 443 (found on the
  # first server, where Cloudflare's connections were dropped with DPT=8443).
  local rule
  while read -r rule; do
    ufw --force delete "$rule" >/dev/null
  done < <(ufw status numbered | grep 'cloudflare' | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn)
  local range
  for range in $v4 $v6; do
    ufw route allow proto tcp from "$range" to any port 8443 comment cloudflare >/dev/null
  done
  ufw reload >/dev/null
  log "firewall: port 443 open to $(wc -w <<<"$v4 $v6") Cloudflare ranges"
}

main "$@"
exit

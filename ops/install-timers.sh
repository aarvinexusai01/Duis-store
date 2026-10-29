#!/usr/bin/env bash
# Installs the server's scheduled tasks as systemd timers (run as root, after
# the checkout exists at /srv/duis; safe to run again):
#   duis-host-check       every 15 minutes   disk, memory, containers, certificate
#   duis-cloudflare-ips   at boot and monthly   firewall and Nginx trusted ranges
#   duis-restore-drill    early each month: the first Saturday, 22:30 UTC (04:00 IST Sunday)
# Also opens port 443 to Cloudflare right away.
set -euo pipefail

[ "$(id -u)" = 0 ] || {
  echo "run as root (sudo)" >&2
  exit 1
}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

unit() {
  local name=$1 user=$2 command=$3 description=$4
  cat >"/etc/systemd/system/$name.service" <<EOF
[Unit]
Description=$description
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$user
WorkingDirectory=$ROOT
ExecStart=$command
EOF
}

timer() {
  local name=$1 schedule=$2 extra=${3:-}
  cat >"/etc/systemd/system/$name.timer" <<EOF
[Unit]
Description=Schedule for $name

[Timer]
$schedule
$extra
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF
}

unit duis-host-check deploy "$ROOT/ops/host-check.sh" "Duis host checks"
timer duis-host-check "OnCalendar=*:0/15"

unit duis-cloudflare-ips root "$ROOT/ops/update-cloudflare-ips.sh" "Refresh Cloudflare address ranges"
timer duis-cloudflare-ips "OnCalendar=monthly" "OnBootSec=2min"

unit duis-restore-drill deploy "$ROOT/ops/restore-drill.sh" "Duis monthly restore drill"
timer duis-restore-drill "OnCalendar=Sat *-*-01..07 22:30:00 UTC"

systemctl daemon-reload
for name in duis-host-check duis-cloudflare-ips duis-restore-drill; do
  systemctl enable --now "$name.timer"
done

"$ROOT/ops/update-cloudflare-ips.sh"
systemctl list-timers 'duis-*' --no-pager

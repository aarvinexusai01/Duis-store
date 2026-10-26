#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 LTS server for Duis (doc/07 §1; runbook:
# first-server-setup). Copy it to the server and run it once as root:
#   scp ops/bootstrap.sh root@<server>:
#   ssh root@<server> 'bash bootstrap.sh --ssh-key "ssh-ed25519 AAAA… you@laptop" --admin-ip 203.0.113.7'
#
# Options:
#   --ssh-key "<public key>"   who may log in as `deploy` (repeatable; required)
#   --admin-ip <ip or cidr>    who may reach SSH (repeatable). Without one, SSH
#                              stays open to everyone, rate-limited: fine with
#                              keys only, tighter with a fixed IP.
#   --swap <size>              swap file size if none exists (default 4G)
#
# It does: OS updates and automatic security updates; a `deploy` user with
# key-only SSH (no root or password logins); Docker Engine and the Compose
# plugin; the firewall (SSH only; ops/install-timers.sh later opens 443 to
# Cloudflare); log rotation; swap; time sync; /srv/duis for the checkout.
# Safe to run again.
set -euo pipefail

SSH_KEYS=()
ADMIN_IPS=()
SWAP_SIZE=4G

log() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case $1 in
    --ssh-key) SSH_KEYS+=("${2:?}") && shift ;;
    --admin-ip) ADMIN_IPS+=("${2:?}") && shift ;;
    --swap) SWAP_SIZE=${2:?} && shift ;;
    *) die "unknown option $1" ;;
  esac
  shift
done

[ "$(id -u)" = 0 ] || die "run as root"
# shellcheck source=/dev/null
. /etc/os-release
[ "$ID" = ubuntu ] || die "this script expects Ubuntu (found $ID)"
[ ${#SSH_KEYS[@]} -gt 0 ] || [ -s /home/deploy/.ssh/authorized_keys ] ||
  die "give at least one --ssh-key, or you would be locked out"

export DEBIAN_FRONTEND=noninteractive

log "updating the system"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl git gnupg jq openssl ufw unattended-upgrades

log "automatic security updates (reboots at 04:00 IST when needed)"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat >/etc/apt/apt.conf.d/52duis-unattended <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "22:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

log "time: UTC, synchronised"
timedatectl set-timezone UTC
timedatectl set-ntp true

log "deploy user"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "Duis deploy" deploy
fi
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
for key in "${SSH_KEYS[@]}"; do
  grep -qxF "$key" /home/deploy/.ssh/authorized_keys || echo "$key" >>/home/deploy/.ssh/authorized_keys
done
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
# The docker group is root-equivalent anyway; sudo without a password keeps
# the key the only secret (there is no password to guess or leak).
echo "deploy ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy
visudo -cq

# A key for pulling the repository (add it to GitHub as a read-only deploy key).
if [ ! -f /home/deploy/.ssh/id_ed25519 ]; then
  sudo -u deploy ssh-keygen -q -t ed25519 -N "" -C "duis-deploy@$(hostname)" -f /home/deploy/.ssh/id_ed25519
fi

log "SSH: keys only, no root login"
cat >/etc/ssh/sshd_config.d/50-duis.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
sshd -t
# Ubuntu 24.04 starts sshd on demand; new connections read the new settings.
systemctl try-reload-or-restart ssh

log "Docker Engine and Compose"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
install -d /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true
}
EOF
systemctl enable --now docker
systemctl restart docker
usermod -aG docker deploy

log "firewall"
# ufw and Docker: Docker publishes container ports through the FORWARD chain,
# past ufw's INPUT rules. These rules (the well-known ufw-docker recipe) send
# forwarded traffic through ufw's route rules, so `ufw route allow` decides
# who reaches Nginx on 443. Containers can still reach each other and the
# internet.
if ! grep -q "BEGIN UFW AND DOCKER" /etc/ufw/after.rules; then
  cat >>/etc/ufw/after.rules <<'EOF'

# BEGIN UFW AND DOCKER
*filter
:ufw-user-forward - [0:0]
:ufw-docker-logging-deny - [0:0]
:DOCKER-USER - [0:0]
-A DOCKER-USER -j ufw-user-forward

-A DOCKER-USER -j RETURN -s 10.0.0.0/8
-A DOCKER-USER -j RETURN -s 172.16.0.0/12
-A DOCKER-USER -j RETURN -s 192.168.0.0/16

-A DOCKER-USER -p udp -m udp --sport 53 --dport 1024:65535 -j RETURN

-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 192.168.0.0/16
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 10.0.0.0/8
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 172.16.0.0/12
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 192.168.0.0/16
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 10.0.0.0/8
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 172.16.0.0/12

-A DOCKER-USER -j RETURN

-A ufw-docker-logging-deny -m limit --limit 3/min --limit-burst 10 -j LOG --log-prefix "[UFW DOCKER BLOCK] "
-A ufw-docker-logging-deny -j DROP

COMMIT
# END UFW AND DOCKER
EOF
fi
ufw default deny incoming
ufw default allow outgoing
ufw default deny routed
if [ ${#ADMIN_IPS[@]} -gt 0 ]; then
  ufw delete limit 22/tcp >/dev/null 2>&1 || true
  for ip in "${ADMIN_IPS[@]}"; do
    ufw allow proto tcp from "$ip" to any port 22 comment admin-ssh
  done
else
  ufw limit 22/tcp comment admin-ssh
fi
ufw --force enable
ufw reload

log "swap and kernel settings"
if ! swapon --show | grep -q .; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
cat >/etc/sysctl.d/90-duis.conf <<'EOF'
vm.swappiness = 10
vm.overcommit_memory = 1
net.core.somaxconn = 4096
# Elasticsearch maps its index files into memory (ADR-0033).
vm.max_map_count = 262144
EOF
sysctl --system >/dev/null

log "checkout folder"
install -d -m 750 -o deploy -g deploy /srv/duis

cat <<EOF

Done. Next (runbook: first-server-setup):
  1. In a NEW terminal, check you can log in before closing this one:
       ssh deploy@<server>
  2. Add this key to GitHub → repository → Settings → Deploy keys (read-only):
       $(cat /home/deploy/.ssh/id_ed25519.pub)
  3. As deploy: git clone git@github.com:<owner>/<repo>.git /srv/duis
  4. Put .env.infra and .env.production in /srv/duis (chmod 600), and the
     origin certificate in /srv/duis/state/nginx/.
  5. sudo /srv/duis/ops/install-timers.sh, then /srv/duis/ops/deploy.sh <ref>
EOF

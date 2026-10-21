#!/usr/bin/env bash
# Prepares a checkout to run the production stack on a laptop (doc/06
# Phase 7a): random local secrets, self-signed certificates, a local S3
# gateway in place of R2, Mailpit for email. Nothing here is for a server.
#   git clone <repo> /tmp/duis-server && cd /tmp/duis-server
#   ops/local/init.sh
#   DUIS_NO_FETCH=1 DEPLOY_DISK_LIMIT=95 ops/deploy.sh HEAD
#   open https://localhost:8443   (self-signed: accept the warning)
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

secret() { openssl rand -hex 24; }

if [ ! -f .env.infra ]; then
  cat >.env.infra <<EOV
DUIS_STACK=local
HSTS_MAX_AGE=300
HTTPS_BIND=127.0.0.1:8443
POSTGRES_PASSWORD=$(secret)
DUIS_OWNER_PASSWORD=$(secret)
DUIS_APP_PASSWORD=$(secret)
DUIS_READONLY_PASSWORD=$(secret)
PG_SHARED_BUFFERS=256MB
PG_EFFECTIVE_CACHE_SIZE=1GB
PG_MEMORY=2G
WEB_MEMORY=1G
BUILD_MEMORY=3g
R2_ENDPOINT=s3.duis.internal
R2_PORT=9000
R2_REGION=auto
R2_BUCKET=duis-backups
R2_ACCESS_KEY_ID=local$(openssl rand -hex 6)
R2_SECRET_ACCESS_KEY=$(secret)
PGBACKREST_CIPHER_PASS=$(secret)
RESTIC_PASSWORD=$(secret)
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)
NEXT_PUBLIC_SENTRY_DSN=
APP_ENV=staging
EOV
  echo "wrote .env.infra"
fi

if [ ! -f .env.production ]; then
  cat >.env.production <<EOV
APP_ENV=staging
APP_URL=https://localhost:8443
LOG_LEVEL=info
BETTER_AUTH_SECRET=$(secret)$(secret)
INTERNAL_REVALIDATE_SECRET=$(secret)$(secret)
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM="Duis <no-reply@duis.local>"
PAYMENT_PROVIDER=fake
SHIPPING_PROVIDER=fake
SMS_PROVIDER=fake
WHATSAPP_PROVIDER=fake
OPS_ALERT_EMAIL=ops@duis.local
EOV
  echo "wrote .env.production"
fi
chmod 600 .env.infra .env.production

self_signed() {
  local dir=$1 name=$2 host=$3
  [ -f "$dir/$name.pem" ] || [ -f "$dir/$name.crt" ] && return
  mkdir -p "$dir"
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=$host" \
    -addext "subjectAltName=DNS:$host" -keyout "$dir/$name.key" -out "$dir/$name.crt" 2>/dev/null
  chmod 644 "$dir/$name.key"
}

self_signed state/nginx origin localhost
[ -f state/nginx/origin.pem ] || mv state/nginx/origin.crt state/nginx/origin.pem
self_signed state/s3 s3 "$(grep '^R2_ENDPOINT=' .env.infra | cut -d= -f2)"
# Docker Desktop's port forwarding arrives from a private address.
printf 'set_real_ip_from %s;\n' 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 >state/nginx/cloudflare-ips.conf

# A laptop disk is often fuller than a server's; DEPLOY_DISK_LIMIT relaxes the check.
echo "ready: DUIS_NO_FETCH=1 DEPLOY_DISK_LIMIT=95 ops/deploy.sh HEAD"

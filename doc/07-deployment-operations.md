# 07 — Deployment & Operations

## 1. Server

| Item | Plan |
|---|---|
| Provider | Cloud VPS in an Indian region (for example AWS Mumbai, DigitalOcean Bangalore, E2E Networks). Final choice is open (see 10). |
| Size (medium scale) | **8 vCPU, 16 GB RAM, 160 GB+ NVMe SSD**, plus provider snapshots enabled. The minimum for launch is 4 vCPU / 8 GB with one web replica. |
| OS | Ubuntu Server LTS (24.04 or 26.04), x86_64 |
| Access | SSH key only, non-root `deploy` user in the `docker` group, root login disabled |
| Firewall | ufw (and the provider's firewall): 443 open only to Cloudflare IP ranges, 80 closed (Cloudflare handles redirects), 22 open to admin IPs only |

**RAM budget:**

| Component | RAM |
|---|---|
| Postgres (`shared_buffers` 4 GB) | ~5 GB |
| 2 × web | ~1–1.5 GB each |
| Worker | ~0.5–1 GB |
| Caddy | ~100 MB |
| Backup | ~200 MB |
| Build headroom during on-server builds | ~4 GB |
| OS page cache | the rest |

## 2. Compose topology (`compose.yaml`)

| Service | Image | Networks | Notes |
|---|---|---|---|
| `caddy` | `caddy:2` (pinned) | edge | Publishes 443. Volumes: Caddyfile, Origin CA cert/key (read-only), `media` (read-only), `caddy_data`. |
| `web_a`, `web_b` | `duis-web:${APP_SHA}` | edge, backend | `node server.js` (standalone). Health check `GET /api/health`. Non-root, read-only root filesystem, tmpfs `/tmp`. Writable volume for `.next/cache`. `media` mounted read-write (uploads). Memory limit 1.5 GB. |
| `worker` | `duis-web:${APP_SHA}` | backend, egress | `node dist/worker.mjs`. Health check via heartbeat file. Same limits. |
| `postgres` | `duis-postgres:18` (custom: postgres:18 + pgBackRest) | backend | Volume `pgdata` at **`/var/lib/postgresql`** (Postgres 18 image layout). No published ports. Tuned `postgresql.conf`. WAL archiving through pgBackRest. |
| `backup` | `duis-backup` (restic + pg_dump + supercronic) | backend, egress | Nightly logical dump and media snapshot to S3. Reads `media` read-only. |
| `migrate` | `duis-web:${APP_SHA}` | backend | `profiles: [tools]`. Runs `node dist/migrate.mjs` as `duis_owner`, then exits. |

- **Networks:** `backend` is `internal: true`, so it has no internet route. Postgres is attached **only** to `backend`. `web_*` are on `edge` + `backend`, and `edge` gives them outbound access to Razorpay, Shiprocket and others. `worker` and `backup` are on `backend` + `egress`, for the APIs and the S3 upload. `caddy` is on `edge` only.
- **Volumes:** `pgdata`, `pgbackrest_spool`, `media`, `next_cache_a`, `next_cache_b`, `caddy_data`.
- **Logging:** the json-file driver with `max-size: 10m`, `max-file: 5` on every service. Apps log JSON to stdout via pino.
- **Restart:** `restart: unless-stopped` everywhere. `depends_on` with `condition: service_healthy` for Postgres.

## 3. Dockerfile (multi-stage)

1. **`base`:** `node:24-<debian>-slim` (pinned by digest), with `ENV NEXT_TELEMETRY_DISABLED=1`.
2. **`deps`:** copy `package.json` and `package-lock.json`, then `npm ci` with a BuildKit cache mount for `~/.npm`.
3. **`build`:**
   - Copy the source and run `npm run build` (`next build` with standalone output).
   - Run `npm run build:worker` and `npm run build:migrate` (tsup → `dist/`).
   - Prune to production dependencies where the worker bundle needs externals (`pg`, `sharp`, `pg-boss`).
4. **`runtime`:**
   - `node:24-<debian>-slim`, non-root user `app` (uid 10001).
   - Copy `.next/standalone`, `.next/static`, `public` and `dist`, plus `node_modules` entries needed only by the worker if they aren't bundled.
   - `HEALTHCHECK`. `USER app`. `CMD ["node","server.js"]`.

Builds on the server are native amd64. Because developer Macs are arm64, any local image built for the server must use `docker buildx build --platform linux/amd64`.

## 4. Deploy and rollback (build on server)

`scripts/deploy.sh <git-ref>` runs as the `deploy` user, in order:

1. **Pre-flight:**
   - Working tree is clean and `.env.production` exists (permissions 600).
   - Disk has more than 15 % free.
   - The last backup is under 26 hours old (otherwise run `backup-now.sh` first).
2. `git fetch --tags && git checkout --detach <ref>` → `APP_SHA=$(git rev-parse --short=12 HEAD)`.
3. `docker compose build web_a` (tags `duis-web:${APP_SHA}`), with BuildKit cache. Run under `nice` to protect live traffic.
4. **Migrate:** `APP_SHA=… docker compose run --rm migrate`. If it fails, abort; the running containers are untouched.
5. **Rolling restart:**
   1. `docker compose up -d --no-deps web_a` and wait until it is healthy.
   2. Then `web_b`, and wait until it is healthy.
   3. Then `worker`. It drains in-flight jobs on SIGTERM, with a 60 s grace period.

   Caddy's health checks and `lb_try_duration` route around whichever replica is restarting.
6. `scripts/smoke-test.sh`: health, home, PDP, `/api/health/ready`, plus a dry run of the webhook signature check.
7. Write `APP_SHA` to `.deployed_sha` and append to `deployments.log` (time, ref, SHA, user).
8. Keep the last **5** images. `docker image prune` removes older SHAs.

`scripts/rollback.sh [sha]` (defaults to the previous entry in `deployments.log`) re-runs step 5 with the old `APP_SHA`. There is no rebuild, so it finishes in under 2 minutes.

**Migration safety:**
- Because migrations are expand/contract (05 §13), the previous image keeps working against the new schema.
- Destructive migrations ship one release after the code stops using the column.
- If a migration itself is faulty, restore from point-in-time recovery to the moment before deploy (§6). The runbook covers this.

**CI's role:** GitHub Actions runs checks on every pull request. `main` is protected, and only commits that passed CI are deployed (by ref or tag).

## 5. Cloudflare and TLS

- **DNS:** apex and `www` proxied (orange cloud). `www` redirects to the apex, or the reverse; to be decided.
- **SSL/TLS mode:** **Full (strict)**. Caddy uses a **Cloudflare Origin CA** certificate (up to 15 years; renewal recorded in the runbook). Optionally, Authenticated Origin Pulls (mTLS) so only Cloudflare can connect.
- **Always Use HTTPS, HSTS** (start with a short `max-age`, raise it after checks), and a TLS 1.2 minimum.
- **Cache rules:** cache `/_next/static/*` and `/media/*`, which are immutable. Bypass `/api/*`, `/admin*`, `/account*`, `/checkout*`. HTML follows the app's `Cache-Control`.
- **Security:** WAF managed rules (free tier), a rate-limit rule on `/api/auth/*`, Bot Fight Mode evaluated against webhook paths (Razorpay and Shiprocket must not be challenged, so add skip rules for `/api/webhooks/*`).
- **Turnstile:** site key and secret for the OTP, register and login forms.
- **Real IP:** Caddy `trusted_proxies` = Cloudflare ranges, `client_ip_headers CF-Connecting-IP`. The app reads the `X-Real-IP` set by Caddy, never a client-supplied header. `update-cloudflare-ips.sh` refreshes the ranges monthly.

## 6. Backups and restore

| What | How | Frequency | Retention | RPO |
|---|---|---|---|---|
| PostgreSQL (physical + WAL) | pgBackRest → S3 bucket (AES-256 repo encryption) | Full weekly, differential daily, WAL continuous | 4 full + 14 days of WAL | **≤ 5 minutes** |
| PostgreSQL (logical) | `pg_dump -Fc` → restic → S3 | Nightly | 30 daily, 12 monthly | 24 h (independent safety net) |
| Media volume | restic → S3 | Nightly + after bulk uploads | 30 daily, 12 monthly | 24 h |
| Config | `.env.production`, Caddy certs → encrypted restic snapshot | On change | 10 versions | n/a |

- **Restore runbook:**
  1. Provision a server.
  2. Bootstrap.
  3. `restore.sh --pitr "<timestamp>"` restores Postgres with pgBackRest, and `restore.sh --media latest` restores media.
  4. Start the stack and run the smoke test.
- **Target RTO:** ≤ 2 hours. Confirm RPO and RTO (see 10).
- **Monthly restore drill:** `restore-drill.sh` restores into a throwaway Compose project and runs integrity queries (row counts, latest order time, a media checksum sample), then reports the result by email.
- **Encryption keys:** the restic password and pgBackRest cipher pass are kept **outside the server** as well (password manager). Without them the backups are useless.
- The backup bucket has **object lock / versioning** turned on where the provider supports it, as protection against ransomware or accidental deletion.

## 7. Monitoring and logging

| Signal | Tooling | Alert |
|---|---|---|
| Uptime | External monitor (for example UptimeRobot or Better Stack free tier) on `https://<domain>/api/health`, every minute | Email (and phone app) after 2 failures |
| Errors | Sentry SDK in web and worker (with `beforeSend` scrubbing PII) → Sentry SaaS or self-hosted GlitchTip | New issue or spike |
| Jobs | pg-boss metrics on the admin System page. A cron check reports dead-letter count > 0 and queue age > threshold. | Email to ops |
| Payments | `payments.reconcile` reports orders stuck in `pending_payment` with captured payments, and reconciliation mismatches | Email to ops |
| Backups | Backup container writes status. The check alerts if the last success is more than 26 h old. | Email |
| Host | A cron script checks disk over 80 %, memory and swap pressure, and container restarts | Email |
| Logs | `docker compose logs` with JSON lines (request ID, user ID hashed, route, latency). Rotated at 50 MB per service. | — |

**Health endpoints:**
- `/api/health` is liveness: fast, with no dependencies.
- `/api/health/ready` checks DB connectivity and migration version. It is used by Caddy's active health checks and the smoke test.

## 8. Routine operations

- **Updates:** Dependabot pull requests weekly. Monthly maintenance window covering base image digests, Postgres minor version and Caddy. OS security updates are automatic (unattended-upgrades), with reboots scheduled.
- **Postgres major upgrades** (for example 18 → 19): tested on a restore of production. Done with `pg_upgrade` in a maintenance window; a runbook is written at that time.
- **Secrets rotation:** a runbook covers the Razorpay webhook secret, Shiprocket API user password, SMTP credentials, `BETTER_AUTH_SECRET` (rotating it invalidates sessions, so plan for that) and the internal HMAC secret.
- **Scaling paths, in order of cost:**
  1. Bigger VPS
  2. A third web replica
  3. Moving Postgres to its own server
  4. Moving media to S3-compatible storage and serving it through Cloudflare
  5. A shared Next.js cache handler (Redis) if more replicas are needed

# 07 — Deployment & Operations

## 1. Server

| Item | Plan |
|---|---|
| Provider | **Bluehost self-managed VPS, Mumbai** (owner decision 2026-10-21). The scripts assume only Ubuntu, root SSH and nothing provider-specific: no firewall API, no snapshots. |
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
| Nginx | ~50 MB |
| Backup | ~200 MB |
| Build headroom during on-server builds | ~4 GB |
| OS page cache | the rest |

## 2. Compose topology (`compose.yaml`)

| Service | Image | Networks | Notes |
|---|---|---|---|
| `nginx` | `nginxinc/nginx-unprivileged:1.30.5-alpine` | edge | Runs as uid 101 on 8443, published as 443. Mounts `docker/nginx/` (the folder, so checkouts update it), `state/nginx` (Origin CA cert/key, Cloudflare ranges, the generated upstream and HSTS files) and `media` (read-only). |
| `web_a`, `web_b` | `duis-web:${APP_SHA}` | edge, backend | `node server.js` (standalone). Health check `GET /api/health`; deploys wait for `/api/health/ready`. Non-root, read-only root filesystem, tmpfs `/tmp`, all capabilities dropped. Writable volume for `.next/cache`. `media` and `private` read-write. Memory limit 1.5 GB. |
| `worker` | `duis-web:${APP_SHA}` | backend, egress | `node dist/worker.mjs`. Health check via heartbeat file. 60 s stop grace. |
| `postgres` | `duis-postgres:<tree hash of docker/postgres>` (postgres:18.6 + pgBackRest + restic + supercronic) | backend, egress | Volume `pgdata` at **`/var/lib/postgresql`** (Postgres 18 image layout). No published ports. `conf/postgresql.conf` and `pg_hba.conf` (superuser on the socket only). WAL archiving through pgBackRest; `egress` is for that alone (ADR-0031). |
| `backup` | same image, as `postgres` | backend, egress | `duis-backup run`: creates the pgBackRest stanza and restic repository, takes the first full backup, then follows `conf/crontab`. Reads `pgdata` and the media volumes read-only; reaches Postgres through the shared socket volume. |
| `migrate` | `duis-web:${APP_SHA}` | backend | `profiles: [tools]`. Runs `node dist/migrate.mjs` as `duis_owner`, then exits. |
| `restore` | same as `postgres` | backend, egress | `profiles: [tools]`. Used by `ops/restore.sh` (as root, so restored files keep their owners). |

- **Networks:**
  - `backend` is `internal: true`, so it has no internet route.
  - Postgres has no published port. It joins `egress` only to push WAL to R2.
  - `web_*` are on `edge` + `backend`; `edge` gives them outbound access to Razorpay, Shiprocket and others.
  - `worker` and `backup` are on `backend` + `egress`, for the APIs and the S3 upload.
  - `nginx` is on `edge` only.
- **Volumes:** `pgdata`, `pgsocket`, `pgbackrest_spool`, `restic_cache`, `media`, `private`, `next_cache_a`, `next_cache_b`.
- **Secrets:**
  - `.env.production` (application) goes to the web replicas and the worker.
  - `.env.infra` (database passwords, R2, backup passphrases, build settings) is read by `ops/compose`, which passes each container only what it needs.
- **Logging:** the json-file driver with `max-size: 10m`, `max-file: 5` on every service. Apps log JSON to stdout via pino.
- **Restart:** `restart: unless-stopped` everywhere. `depends_on` with `condition: service_healthy` for Postgres.
- **Always use `ops/compose`:** it sets the project name, env file and image tags.
- **Locally:** `compose.local.yaml` adds an S3 gateway and Mailpit (runbook: local-stack).

## 3. Dockerfile (multi-stage)

1. **`base`:** `node:24-<debian>-slim` (pinned by digest), with `ENV NEXT_TELEMETRY_DISABLED=1`.
2. **`deps`:** copy `package.json` and `package-lock.json`, then `npm ci` with a BuildKit cache mount for `~/.npm`.
3. **`build`:**
   - Copy the source and run `npm run build` (`next build` with standalone output).
   - Run `npm run build:worker` and `npm run build:migrate` (tsup → `dist/`).
   - Prune to production dependencies where the worker bundle needs externals (`pg`, `sharp`, `pg-boss`).
4. **`runtime`:**
   - `node:24.21.0-trixie-slim`, running as the image's non-root `node` user (uid 1000). Application files stay root-owned and read-only; only `.next/cache` is writable.
   - Copy `.next/standalone`, `.next/static`, `public` and `dist`, plus `node_modules` entries needed only by the worker if they aren't bundled.
   - `HEALTHCHECK`. `USER app`. `CMD ["node","server.js"]`.

Builds on the server are native amd64. Because developer Macs are arm64, any local image built for the server must use `docker buildx build --platform linux/amd64`.

## 4. Deploy and rollback (build on server)

`ops/deploy.sh <git-ref>` runs as the `deploy` user, in order (runbook: deploy):

1. **Pre-flight:**
   - Working tree is clean and `.env.production` exists (permissions 600).
   - Disk has more than 15 % free.
   - The last backup is under 26 hours old (otherwise run `backup-now.sh` first).
2. `git fetch --tags && git checkout --detach <ref>` → `APP_SHA=$(git rev-parse --short=12 HEAD)`.
3. Build `duis-web:${APP_SHA}` in the `duis-builder` BuildKit container, which has low CPU priority (`cpu-shares` 128) and a memory cap (4 GB). Live traffic gets the CPU first whenever both need it (ADR-0031). `nice` would not help, because BuildKit runs inside Docker, not under the script.
4. **Migrate:** `APP_SHA=… docker compose run --rm migrate`. If it fails, abort; the running containers are untouched.
5. **Rolling restart, one replica at a time:**
   1. Mark `web_a` `down` in `state/nginx/upstream.conf` and reload Nginx gracefully. New requests go to `web_b`; the old workers finish the requests they hold (the script waits for them).
   2. `up -d --no-deps web_a` with the new image. Wait until it is healthy **and** ready, then mark it up and reload again.
   3. Then `web_b` the same way. If a new replica never becomes ready, the previous image is put back.
   4. Then `worker`. It finishes in-flight jobs on SIGTERM, with a 60 s grace period.

   Open-source Nginx has no active health checks, hence the explicit `down` (ADR-0031). Safe requests that still meet a dead replica are retried on the other one.
6. Recreate `backup` if its image changed, and reload Nginx's configuration. Postgres and Nginx are never restarted by a deploy.
7. `ops/smoke-test.sh`:
   - health, plus both replicas reporting the new SHA;
   - home with the HSTS and CSP headers;
   - a product page and one of its images (from the media volume);
   - `/api/internal/*` blocked;
   - a bad Razorpay webhook signature returning 401.
8. Write the SHA to `state/deployed_sha` and append to `state/deployments.log` (time, action, ref, SHA, user).
9. Keep the last **5** deployed images.

`ops/rollback.sh [sha]` (defaults to the previous entry in `deployments.log`) re-runs step 5 with the old `APP_SHA`. There is no rebuild, so it finishes in under 2 minutes.

**Migration safety:**
- Because migrations are expand/contract (05 §13), the previous image keeps working against the new schema.
- Destructive migrations ship one release after the code stops using the column.
- If a migration itself is faulty, restore from point-in-time recovery to the moment before deploy (§6). The runbook covers this.

**CI's role:** GitHub Actions runs checks on every pull request. `main` is protected, and only commits that passed CI are deployed (by ref or tag).

## 5. Cloudflare and TLS

- **DNS:** apex and `www` proxied (orange cloud). `www` redirects to the apex, or the reverse; to be decided.
- **SSL/TLS mode:** **Full (strict)**. Nginx uses a **Cloudflare Origin CA** certificate (up to 15 years; renewal recorded in the runbook). Optionally, Authenticated Origin Pulls (mTLS) so only Cloudflare can connect.
- **Always Use HTTPS, HSTS** (start with a short `max-age`, raise it after checks), and a TLS 1.2 minimum.
- **Cache rules:** cache `/_next/static/*` and `/media/*`, which are immutable. Bypass `/api/*`, `/admin*`, `/account*`, `/checkout*`. HTML follows the app's `Cache-Control`.
- **Security:** WAF managed rules (free tier), a rate-limit rule on `/api/auth/*`, Bot Fight Mode evaluated against webhook paths (Razorpay and Shiprocket must not be challenged, so add skip rules for `/api/webhooks/*`).
- **Turnstile:** site key and secret for the OTP, register and login forms.
- **Real IP:** Nginx `set_real_ip_from` = Cloudflare ranges, `real_ip_header CF-Connecting-IP`. The app reads the `X-Real-IP` set by Nginx, never a client-supplied header. `update-cloudflare-ips.sh` refreshes the ranges monthly.

## 6. Backups and restore

| What | How | Frequency | Retention | RPO |
|---|---|---|---|---|
| PostgreSQL (physical + WAL) | pgBackRest → S3 bucket (AES-256 repo encryption) | Full weekly, differential daily, WAL continuous | 4 full + 14 days of WAL | **≤ 5 minutes** |
| PostgreSQL (logical) | `pg_dump -Fc` → restic → S3 | Nightly | 30 daily, 12 monthly | 24 h (independent safety net) |
| Media volume | restic → S3 | Nightly + after bulk uploads | 30 daily, 12 monthly | 24 h |
| Config | `.env.production`, `.env.infra`, origin certificate → password manager (they are small; the runbooks list them) | On change | 10 versions | n/a |

- **Restore runbook** (doc/runbooks/restore.md):
  1. Provision a server.
  2. Bootstrap.
  3. `ops/restore.sh --latest` or `--pitr "<time>"` restores Postgres with pgBackRest; `--media` restores the images.
  4. Start the stack and run the smoke test.
- **Target RTO:** ≤ 2 hours. Confirm RPO and RTO (see 10).
- **Monthly restore drill:** `restore-drill.sh` restores into a throwaway Compose project and runs integrity queries (row counts, latest order time, a media checksum sample), then reports the result by email.
- **Encryption keys:** the restic password and pgBackRest cipher pass are kept **outside the server** as well (password manager). Without them the backups are useless.
- The backup bucket has **object lock / versioning** turned on where the provider supports it, as protection against ransomware or accidental deletion.

## 7. Monitoring and logging

| Signal | Tooling | Alert |
|---|---|---|
| Uptime | External monitor (for example UptimeRobot or Better Stack free tier) on `https://<domain>/api/health`, every minute | Email (and phone app) after 2 failures |
| Errors | Sentry SaaS (owner decision 2026-10-21) in the server, the browser and the worker; off while no DSN is set. Local variables, bodies, cookies and query strings aren't collected, and `beforeSend` removes emails, phone numbers and tokens (`src/lib/sentry-scrub.ts`) | New issue or spike |
| Jobs | pg-boss metrics on the admin System page. Server checks: failed jobs, and jobs waiting over 15 minutes. | Email to ops |
| Payments | `payments.reconcile` reports orders stuck in `pending_payment` with captured payments, and reconciliation mismatches | Email to ops |
| Backups | The backup container writes each result to `ops_checks`. It fails after 26 h without a success, or 35 days without a passing drill. WAL archiving is checked live. | Email, and `/api/health/ops` |
| Host | `ops/host-check.sh` (systemd timer, every 15 min): disk over 80 %, memory and swap pressure, unhealthy or restarting containers, origin certificate under 30 days | Email, and `/api/health/ops` |
| Logs | `docker compose logs` with JSON lines (request ID, user ID hashed, route, latency). Rotated at 50 MB per service. | — |

**Health endpoints:**
- `/api/health` is liveness: fast, with no dependencies.
- `/api/health/ready` checks DB connectivity. It reports the running SHA. Deploys, the smoke test and UptimeRobot use it.
- `/api/health/ops` returns 503 when any server check fails (below). UptimeRobot watches it too, so ops hear about problems even if the worker that emails alerts is down.

**Server checks (ADR-0031):**
- The backup container, the host-check timer and the restore drill write rows in `ops_checks`. Worker heartbeat, failed jobs, stuck queues and WAL archiving are read live.
- The worker's `system.ops-check` job, every 15 minutes, emails `OPS_ALERT_EMAIL` about new failures, repeats every 6 hours, and reports recoveries.
- All checks show on `/admin/system`.

## 8. Routine operations

- **Updates:** Dependabot pull requests weekly. Monthly maintenance window covering base image digests, Postgres minor version and Nginx. OS security updates are automatic (unattended-upgrades), with reboots scheduled.
- **Postgres major upgrades** (for example 18 → 19): tested on a restore of production. Done with `pg_upgrade` in a maintenance window; a runbook is written at that time.
- **Secrets rotation:** a runbook covers the Razorpay webhook secret, Shiprocket API user password, SMTP credentials, `BETTER_AUTH_SECRET` (rotating it invalidates sessions, so plan for that) and the internal HMAC secret.
- **Scaling paths, in order of cost:**
  1. Bigger VPS
  2. A third web replica
  3. Moving Postgres to its own server
  4. Moving media to S3-compatible storage and serving it through Cloudflare
  5. A shared Next.js cache handler (Redis) if more replicas are needed

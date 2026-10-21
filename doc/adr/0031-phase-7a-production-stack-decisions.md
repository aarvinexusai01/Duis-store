# ADR-0031: Phase 7a, the production stack

- Status: Accepted
- Date: 2026-10-21
- Deciders: On 2026-10-21 the owner chose:
  - a Bluehost self-managed VPS in Mumbai;
  - Cloudflare R2 for off-server backups;
  - Sentry SaaS and UptimeRobot;
  - two slices: 7a in the repository and proven locally, 7b on the server together;
  - a Content Security Policy without nonces;
  - open-source Nginx in place of Caddy, with deploys marking a replica `down` and reloading.

## Decisions

### Nginx in place of Caddy

**Decision.**
- **Edge server:** open-source Nginx (`nginxinc/nginx-unprivileged:1.30.5-alpine`) replaces Caddy (ADR-007), behind Cloudflare as before.
- **Unprivileged:** it runs as uid 101 on port 8443, published as 443, with no extra Linux capabilities.
- **Configuration:** `docker/nginx/nginx.conf` and `proxy.conf` are static. The per-server parts are generated into `state/nginx/` by the ops scripts: the upstream list, the HSTS header, Cloudflare's ranges and the certificate. A graceful `nginx -s reload` applies every change.
- **Finding replicas:** upstream servers use `resolve` with Docker's DNS, so recreated replicas are found again by name.

**Why.** The owner's choice (2026-10-21), for familiarity. Everything the plan
asked of Caddy maps to standard Nginx modules, except active health checks
(below).

### Content Security Policy without nonces

**Decision.**
- Every response carries a CSP built by `src/lib/csp.ts` and set in `next.config.ts`.
- Sources are allow-listed (Razorpay, Google tag, Meta, Turnstile, YouTube no-cookie, Instagram, the Sentry ingest host).
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self' Razorpay`, `frame-ancestors 'none'` (`'self'` for CMS previews).
- Inline scripts stay allowed. There are no per-request nonces.
- doc/08 is corrected to match.

**Why.**
- Next only adds nonces to pages rendered per request. Nonces would turn every cached page shell into an on-demand render, costing speed and server capacity at peak.
- XSS is handled where it starts: React escaping, the allow-list rich-text renderer, and no raw HTML from the CMS.

### One Postgres image for the database and its backups

**Decision.**
- **One image:** `duis-postgres` is Postgres 18 plus pgBackRest, restic and supercronic. It runs both the `postgres` service and the `backup` service.
- **How the backup service reaches the database:** it mounts the data volume read-only and shares Postgres's socket. That lets pgBackRest take physical backups without SSH or a TLS server between containers.
- **Who logs in where:**
  - the socket trusts local users;
  - TCP accepts only the three application roles, with passwords;
  - the superuser has no network login.

**Why.**
- pgBackRest, `pg_dump` and the server always have matching versions.
- There's no repository host to run.

### Postgres gets outbound access

**Decision.** Postgres sits on the internal `backend` network and also on
`egress` (outbound only), so its archive command can push WAL to R2. It still
publishes no port.

**Why.**
- Continuous archiving runs inside Postgres.
- A relay through another container would add a moving part to the most important backup path.

### Health checks that alert even when the worker is down

**Decision.**
- **One table:** each check has a row in `ops_checks`.
  - Backups write theirs: pgBackRest, restic and the drill.
  - The host script writes disk, memory, containers and certificate every 15 minutes.
  - Worker heartbeat, failed jobs, stuck queues and WAL archiving are read live.
- **Email:** the worker's `system.ops-check` job (every 15 minutes) emails `OPS_ALERT_EMAIL` when a check fails, repeats every 6 hours while it stays failing, and reports recovery.
- **Uptime monitor:** `/api/health/ops` answers 503 when any check fails. UptimeRobot watches it besides `/api/health/ready`, so a dead worker or database still raises an alarm.
- **System page:** `/admin/system` shows every check.

**Why.**
- One place for every signal.
- No mail setup on the host.
- The uptime monitor covers the case where the alerting process itself is down.

### Zero-downtime deploys by marking replicas down

**Decision.**
- **Take it out first:** before a replica is replaced, `ops/deploy.sh` rewrites `state/nginx/upstream.conf` with that replica marked `down`. It checks the config with `nginx -t` and reloads. New workers stop sending it requests; the old workers finish the ones they hold, and the script waits for them to exit.
- **Replace:** the new container starts. Once its own readiness check passes, it is marked up and Nginx reloads again.
- **Retry:** safe requests (not POST) that still meet a dead replica are retried once on the other (`proxy_next_upstream`).
- **Version check:** readiness reports the running git SHA, so deploys and the smoke test can confirm both replicas switched.

**Why.**
- Open-source Nginx has no active health checks (that's NGINX Plus).
- Next's standalone server exits on SIGTERM without draining.
- Taking the replica out of rotation explicitly means no request is cut off, POSTs included (owner decision 2026-10-21, preferred over passive failover).

### Builds are held back from live traffic

**Decision.** `ops/deploy.sh` builds in a dedicated BuildKit container
(`duis-builder`, docker-container driver), with `cpu-shares` 128 and a 4 GB
memory cap, both configurable in `.env.infra`.

**Why.**
- **What we saw:** in the local proof, building the image on the same machine as the live replicas starved them. Requests waited over 30 s while Next compiled.
- **Why `nice` didn't help:** the plan's `nice` doesn't reach the build, which runs inside Docker's BuildKit, not under the script.
- **Why shares:** low CPU shares give the replicas priority only when they need it, so an idle server still builds at full speed.

### Deploys never restart Postgres or Nginx

**Decision.**
- **Postgres:** the image is tagged by the git tree hash of `docker/postgres`. Deploys create Postgres if it's missing, and otherwise leave it running and print a note when its image changed. Restarting it is a deliberate step (runbook: deploy).
- **Nginx:** configuration changes are reloaded without dropping connections. Its image changes only by a deliberate restart (runbook: deploy).

**Why.** A routine release must not cause a database restart.

### Secrets split between two files

**Decision.**
- **`.env.production`:** the application's own secrets. It's given to the web replicas and the worker.
- **`.env.infra`:** database role passwords, R2 keys, backup passphrases and build settings.
  - `ops/compose` uses it for compose interpolation;
  - compose passes each container only the values it needs;
  - the app's `DATABASE_URL` is assembled from it.

**Why.** A compromised web container can't read the backup keys, nor the
schema owner's or superuser's passwords.

### Backups protection in R2

**Decision.**
- The R2 token is scoped to the backup bucket.
- Bucket lock rules are recommended for the `pgbackrest/` prefix only, for 7 days (shorter than its 4-week retention).
- The restic prefix stays unlocked, because restic's pruning deletes recent index and lock files.

**Why.** R2 has no object versioning. Locking the prefix that pgBackRest never
rewrites gives ransomware protection without breaking restic.

### Body limits

**Decision.** Nginx allows:
- 16 MB on `/api/media/upload` (staff images, 15 MB);
- 10 MB on `/api/photos` (customer photos, 8 MB);
- 2 MB elsewhere.

**Why.** The plan's 1 MB default was below what a 1 MB CSV Server Action
sends once encoded. Next keeps its own 1 MB limit on actions.

### Local proof uses a different S3 gateway

**Decision.**
- `compose.local.yaml` runs versitygw (v1.8.0) with TLS in place of R2.
- `ops/local/init.sh` writes random local secrets and self-signed certificates.

**Why.**
- MinIO no longer publishes container images.
- pgBackRest requires TLS for S3.

### Postgres runs under an init process

**Decision.** The `postgres` service has `init: true`, so tini is PID 1 and
Postgres runs below it.

**Why.**
- **What broke:** found in the local proof. pgBackRest's asynchronous `archive-push` leaves a background process behind. With Postgres as PID 1, that process became its child.
- **The effect:** when the process exited with an error (the bucket unreachable), Postgres 18 treated it as a crashed backend. It restarted every connection, every 10 seconds, until the bucket came back. A seed run against the database died the same way.
- **The fix:** tini reaps the process instead.

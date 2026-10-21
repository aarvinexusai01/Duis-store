# First server setup

From a bare VPS to the live site. Allow about two hours. You need:

- **The VPS:** a Bluehost self-managed VPS in Mumbai (owner decision 2026-10-21), Ubuntu 24.04 LTS, at least 8 vCPU / 16 GB (4 vCPU / 8 GB runs one web replica). Note its IPv4 address.
- **The domain** added to Cloudflare, with DNS managed there.
- **A Cloudflare R2 bucket** for backups (e.g. `duis-backups`), and an R2 API token with *Object Read & Write* on that bucket only.
- **A Sentry project** (Next.js platform); copy its DSN.
- **An SMTP account** for email (doc/10).
- **A password manager entry** for every secret created below.

## 1. Bootstrap the server

From your laptop (replace the key and IP with yours; `--admin-ip` is the
address you connect from, if it's fixed):

```sh
scp ops/bootstrap.sh root@<server-ip>:
ssh root@<server-ip> 'bash bootstrap.sh --ssh-key "$(cat ~/.ssh/id_ed25519.pub)" --admin-ip <your-ip>'
```

Before closing that session, check in a **new terminal** that
`ssh deploy@<server-ip>` works. Root login is now off.

## 2. Get the code

1. Add the public key the script printed to GitHub → repository → Settings → Deploy keys (read-only).
2. Clone the repository:

   ```sh
   git clone git@github.com:<owner>/<repo>.git /srv/duis
   cd /srv/duis
   ```

## 3. Secrets and settings

```sh
cp ops/env/infra.env.example .env.infra
cp ops/env/app.env.example .env.production
chmod 600 .env.infra .env.production
```

Fill both in. Generate each password or key with `openssl rand -hex 32`, and
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` with `openssl rand -base64 32`. In
`.env.infra`:

- `SITE_ADDRESS`: the apex and `www`, e.g. `duis.in, www.duis.in`.
- `R2_ENDPOINT`: `<account-id>.r2.cloudflarestorage.com`, plus the bucket and token.
- `NEXT_PUBLIC_SENTRY_DSN`: the Sentry DSN.

In `.env.production`:

- `APP_URL`: `https://<domain>`.
- The live provider keys (doc/10 §4).
- `SENTRY_DSN`: the same Sentry DSN.
- `OPS_ALERT_EMAIL`: who gets server alerts.

**Store `PGBACKREST_CIPHER_PASS`, `RESTIC_PASSWORD` and the database
passwords in the password manager now.** Without them the backups cannot be
read.

## 4. Origin certificate

Cloudflare → SSL/TLS → Origin Server → Create certificate. Use RSA, cover the
apex and `*.domain`, and choose 15 years. Save the two parts on the server:

```sh
mkdir -p state/nginx
nano state/nginx/origin.pem   # the certificate
nano state/nginx/origin.key   # the private key
# Nginx runs as uid/gid 101 inside its container; only it and you may read the key.
chmod 640 state/nginx/origin.key && sudo chgrp 101 state/nginx/origin.key
```

## 5. Timers and firewall

```sh
sudo ops/install-timers.sh
```

This opens port 443 to Cloudflare's address ranges only and writes Nginx's
trusted-proxy list. It also starts the host checks (every 15 minutes), the
monthly Cloudflare range refresh and the monthly restore drill.

## 6. First deploy

```sh
ops/deploy.sh <tag-or-commit>
```

The first run:
- builds the images (10–15 minutes);
- creates the database and runs the migrations;
- starts everything;
- makes the first full backup;
- runs the smoke test against the server itself.

Then create the first admin:

```sh
ops/compose run --rm --no-deps web_a node dist/create-super-admin.mjs --email you@example.com --name "Your Name"
```

It prints a generated password once; store it in the password manager.
Two-factor setup is required at first sign-in.

## 7. Cloudflare

1. **DNS:** `A` records for the apex and `www` pointing at the server, proxied (orange cloud). No AAAA record.
2. **SSL/TLS:**
   - mode **Full (strict)**;
   - Always Use HTTPS on;
   - minimum TLS 1.2.
3. **Rules:**
   - redirect `www` to the apex (or the reverse);
   - cache rules: cache `/_next/static/*` and `/media/*`; bypass `/api/*`, `/admin*`, `/account*`, `/checkout*`.
4. **Security:**
   - WAF managed rules on;
   - a rate-limit rule on `/api/auth/*`;
   - a **skip rule for `/api/webhooks/*`** (Razorpay and Shiprocket must not be challenged).
5. **Turnstile:** create a widget for the domain and put its keys in `.env.production`. Then redeploy the same ref: `ops/deploy.sh <ref>`.

Check from your laptop:
- `https://<domain>` loads.
- `curl -k https://<server-ip>` times out, because the origin isn't reachable directly.

## 8. Monitoring

- **UptimeRobot:** add two HTTP(S) monitors, every 1 minute, alerting after 2 failures:
  - `https://<domain>/api/health/ready`: the site is serving;
  - `https://<domain>/api/health/ops`: every server check passes. It answers 503 when one fails, including when the worker that sends alert emails is down.
- **Sentry:** trigger a test error (Sentry → project → "Verify installation"), and check that no email or phone number appears in the event.

## 9. Prove it

- `ops/rollback.sh` then `ops/deploy.sh <ref>`: both finish without errors. Time the rollback: it must be under 2 minutes.
- `ops/restore-drill.sh`: it passes, and **Monthly restore drill** turns green on `/admin/system`.
- Once everything has worked for a week, raise `HSTS_MAX_AGE` in `.env.infra` to `31536000` and run `ops/reload-nginx.sh`.

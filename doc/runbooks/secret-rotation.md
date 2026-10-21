# Secret rotation

Change a secret when it may have leaked, when someone with access leaves, or
on the schedule below. After editing `.env.production`, redeploy the same ref
(`ops/deploy.sh $(cat state/deployed_sha)`), so each replica restarts with no
downtime. Update the password manager every time.

| Secret | Where | Notes |
|---|---|---|
| Razorpay webhook secret | Razorpay dashboard → Webhooks, then `RAZORPAY_WEBHOOK_SECRET` | Webhooks are rejected between the two changes; reconciliation (every 5 minutes) catches up any missed payment |
| Razorpay API keys | Razorpay → API keys (regenerate), then `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Do it in a quiet hour |
| Shiprocket API user | Shiprocket → API user password, then `SHIPROCKET_API_PASSWORD` | |
| SMTP | Provider console, then `SMTP_PASSWORD` | Send a test email from `/admin/settings` |
| `BETTER_AUTH_SECRET` | `.env.production` | **Signs everyone out**, customers included. Only if it leaked |
| `INTERNAL_REVALIDATE_SECRET` | `.env.production` | Both replicas and the worker restart with it |
| R2 token | Cloudflare → R2 → API tokens. Create the new one, update `.env.infra`, restart Postgres and backup, then delete the old token | `ops/compose up -d --no-deps backup`; Postgres reads it at start ([Deploy](deploy.md#postgres-or-nginx-image-updates)) |
| Database passwords | See below | |
| Backup passphrases | Never rotate in place | Changing them makes existing backups unreadable. If one leaked, see below |

## Database passwords

The roles' passwords are set when the volume is created, so changing them
takes two steps. For the app role:

```sh
NEW=$(openssl rand -hex 32)
ops/compose exec postgres psql -U postgres duis -c "alter role duis_app password '$NEW'"
# put $NEW in DUIS_APP_PASSWORD in .env.infra, then roll the app:
ops/deploy.sh $(cat state/deployed_sha)
```

Do the same for `duis_owner` (used only by migrations) and `duis_readonly`.
The `postgres` superuser has no network login at all, so its password matters
only for the socket and can stay.

## A backup passphrase leaked

Leaking a passphrase alone isn't enough to read the backups (the R2 token is
also needed), but treat it as serious:
1. Rotate the R2 token.
2. Start new repositories:
   1. Create a new bucket.
   2. Set new passphrases and the new bucket in `.env.infra`.
   3. Recreate Postgres and backup (it runs `stanza-create` and a first full backup).
3. Keep the old bucket until the new one holds 30 days of history, then delete it.

## Origin certificate

Cloudflare Origin CA certificates last up to 15 years. The host check warns 30
days before expiry.
1. Create a new one (Cloudflare → SSL/TLS → Origin Server).
2. Replace `state/nginx/origin.pem` and `origin.key` (`chmod 640`, `sudo chgrp 101` on the key).
3. Run `ops/reload-nginx.sh`.

## Staff leaving

1. Disable their admin account in `/admin/staff`, which ends their sessions.
2. If they had server access, remove their key from `/home/deploy/.ssh/authorized_keys`.
3. Rotate every secret they could read.

# Restore

Backups live in the R2 bucket (doc/07 §6):

| Copy | Tool | Recovers |
|---|---|---|
| Database: full weekly, differential daily, every change continuously (WAL) | pgBackRest, encrypted | any moment of the last ~4 weeks, to within 5 minutes |
| Database dump, nightly | restic, encrypted | the state at 03:30 IST, 30 days and 12 months back (safety net) |
| Images and private files (labels), nightly | restic | the state at 03:30 IST, same retention |

`ops/backup-now.sh status` lists what the bucket holds.

**Before restoring production, take a backup of what's there now**
(`ops/backup-now.sh full`), unless the database won't start. A restore you
regret should itself be reversible.

## The database to a moment in time

For example, to just before a bad bulk edit at 14:05 IST:

```sh
ops/restore.sh --pitr "2026-10-21 14:04:00+05:30"
```

It:
1. asks you to type `restore`;
2. stops the app, the worker and backups;
3. restores, then replays changes up to that moment;
4. starts everything again;
5. takes a fresh full backup (the restored database starts a new history);
6. runs the smoke test.

Downtime is roughly 5–15 minutes, depending on database size and how far back
you go. Put the store in maintenance via Cloudflare first if that's better
for customers.

**Everything after that moment is lost**, including orders and payments.
Before restoring past live orders:
- export them from `/admin/orders`;
- reconcile them with the Razorpay dashboard afterwards.

## A migration damaged data

1. Roll back the code: `ops/rollback.sh`.
2. Restore the database to a minute before the deploy started. `state/deployments.log` shows the time, in UTC:

   ```sh
   ops/restore.sh --pitr "<deploy time minus one minute>+00:00"
   ```
3. Fix the migration before deploying again.

## Images

```sh
ops/restore.sh --media                 # newest snapshot
ops/compose run --rm restore status    # list snapshots, then:
ops/restore.sh --media <snapshot-id>
```

Restoring images only adds and overwrites files; it never deletes any.

## The server is gone

On a new server:
1. Follow [First server setup](first-server-setup.md) steps 1–5 with the **same** `.env.infra` and `.env.production`, from the password manager. The bucket, keys and passphrases must match.
2. Before the first deploy, restore:

   ```sh
   ops/restore.sh --latest --media --yes
   ops/deploy.sh <the last deployed ref> --skip-backup-check
   ```
3. Point Cloudflare's DNS at the new IP.

Expect about 1–2 hours in total, most of it setup (target RTO: 2 hours).
Data loss is at most the last few minutes of database changes, and up to a
day of images uploaded since the night before.

# Incident first steps

1. **Look:**
   - the `/admin/system` page (server checks, queues, failed jobs);
   - Sentry (new errors);
   - `ops/compose ps` (container health).
2. **Is the shop taking orders?** Open the site, add to cart, start checkout. If not, that comes first.
3. **Last change?** `tail state/deployments.log`. If it started after a deploy, roll back first (`ops/rollback.sh`) and investigate after.
4. **Write down** what you see and do, with times. That becomes the follow-up note.

## Site down

UptimeRobot says `/api/health/ready` fails.

- **`ops/compose ps`:**
  - nginx, web_a and web_b should be `healthy`.
  - If both web replicas are unhealthy, check `ops/compose logs --tail 200 web_a`.
  - Readiness fails when the database is unreachable, so check `postgres` too.
- **Postgres down:** see `ops/compose logs --tail 200 postgres`.
  - **Disk full** is the usual cause: see [The server](#the-server).
  - Then `ops/compose up -d --no-deps postgres`.
- **Everything healthy on the server:**
  - run `ops/smoke-test.sh`, which bypasses Cloudflare.
  - If that passes, the problem is DNS, Cloudflare or the firewall. Check Cloudflare's status page and SSL mode, and that `sudo ufw status` lists the Cloudflare ranges on 443.
- **Bad release:** `ops/rollback.sh`.

## Worker and jobs

**Background worker** (no heartbeat for 5 minutes):

```sh
ops/compose ps worker
ops/compose logs --tail 200 worker
ops/compose up -d --no-deps worker
```

While the worker is down, nothing is lost: emails, refunds, parcel bookings
and expiries wait in the queue and run when it is back.

**Failed background jobs:**
1. Open `/admin/system`, read the error and fix the cause (for example a provider outage or an expired API key).
2. Then **Retry** each job, or **Discard** it if it must not run again.
3. The alert clears when none are left.

**Job queues** (jobs waiting over 15 minutes): usually the worker is down or
overloaded. Check its memory with `docker stats`. A queue stuck after a
restart can mean a handler that hangs: see the worker log and Sentry.

## Backups

**Continuous database archiving (WAL)** is the most urgent backup alert.
Without it, point-in-time restore stops working and WAL files pile up on the
server's disk.

```sh
ops/compose logs --tail 100 postgres | grep -i archive
ops/compose exec backup pgbackrest --stanza=duis check
```

The usual causes:
- the R2 token expired or was revoked;
- the bucket was renamed;
- R2 is having an outage (check Cloudflare's status page).

Fix the cause. Postgres retries on its own, and the check turns green once a
file is archived.

**Database backup** or **Nightly copy** (no success in 26 hours):

```sh
ops/compose logs --tail 200 backup
ops/backup-now.sh diff       # or: ops/backup-now.sh nightly
```

## The server

**Disk space** (over 80 %):

```sh
df -h; docker system df
docker image prune -f                # unused images (deploy keeps the last five)
docker builder prune -f --filter until=168h
sudo journalctl --vacuum-time=14d
```

If the media volume is what grows, see [Moving media to R2](media-to-r2.md).
If `pg_wal` grows, WAL archiving is failing (above). Never delete files in
the database volume by hand.

**Memory:**
- `docker stats` shows who uses it.
- A replica that keeps growing: restart it with `ops/compose up -d --no-deps --force-recreate web_a` (one at a time). Then report the leak.

**Containers** (unhealthy, missing or restarting):
- run `ops/compose ps` and `ops/compose logs --tail 200 <service>`;
- `docker inspect <container> | grep -i oom` shows a memory kill.

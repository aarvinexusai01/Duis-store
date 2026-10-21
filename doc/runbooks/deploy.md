# Deploy

```sh
cd /srv/duis
ops/deploy.sh <tag-or-commit>
```

Deploy only commits that passed CI on GitHub. The script:

1. **Pre-flight:**
   - the checkout has no local changes;
   - the env files exist and are `chmod 600`;
   - the disk is under 85 % full;
   - a database backup from the last 26 hours exists. If not, it takes one first.
2. **Build:** checks out the ref and builds `duis-web:<sha>`, skipped if the image already exists. The build runs in its own container with low CPU priority and a 4 GB memory cap, so the shop stays responsive while it compiles. Tune it with `BUILD_CPU_SHARES` / `BUILD_MEMORY` in `.env.infra`, then run `docker buildx rm duis-builder`.
3. **Migrate:** if the migration fails, nothing else has changed. Fix forward, or see [Restore](restore.md#a-migration-damaged-data).
4. **Replace the replicas one at a time:**
   1. Nginx marks the old replica `down` and reloads gracefully. New requests go to the other replica, and requests already running finish.
   2. The new one starts and passes its readiness check. Nginx then sends it traffic again.
   3. Then web_b, then the worker (which finishes its running jobs first).
   4. If a new replica never becomes ready, the previous build is put back automatically.
5. **Smoke test and record:** checks health, the home page, a product page, an image, the security headers, the blocked internal API and the webhook signature check. Then it records the deploy in `state/deployments.log` and keeps the last five images.

A deploy takes 10–15 minutes when it builds, and about 1 minute when it
re-deploys an image that already exists.

## Migrations must be backwards compatible

The old build keeps running against the new schema during the rollout, and
after a rollback (doc/05 §13). So:
- add columns as nullable or with defaults;
- stop using a column in one release, and drop it in a later one.

## Postgres or Nginx image updates

Deploys never restart Postgres or Nginx, which would cause a short outage.
When a release changes `docker/postgres/` or the Nginx version, the deploy
prints a note for Postgres; check the Nginx version in `compose.yaml` yourself. Do this in a quiet moment:

```sh
ops/backup-now.sh full                                  # Postgres only
ops/compose up -d --no-deps postgres                    # about 10–30 s of errors
ops/compose up -d --no-deps nginx                       # about 1–2 s
ops/smoke-test.sh
```

Changes to `docker/nginx/` are picked up by every deploy with a graceful
reload, after `nginx -t` has checked them.

## Useful commands

```sh
ops/compose ps                         # what runs, and its health
ops/compose logs -f --tail 100 web_a   # one service's log
tail state/deployments.log             # deploy history
ops/smoke-test.sh --public             # the same checks through Cloudflare
```

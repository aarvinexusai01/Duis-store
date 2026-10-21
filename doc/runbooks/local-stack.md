# Local production stack

Runs the real production stack on a laptop, for trying deploys, rollbacks,
backups and restores without a server:
- Nginx;
- two web replicas;
- the worker;
- Postgres with pgBackRest;
- the backup container.

A local S3 gateway stands in for R2, and Mailpit catches alert emails.

Use a separate clone, because deploys check out commits:

```sh
git clone <repo> ~/duis-server && cd ~/duis-server
ops/local/init.sh                                  # local secrets and certificates
DUIS_NO_FETCH=1 DEPLOY_DISK_LIMIT=95 ops/deploy.sh HEAD
```

- **Store:** <https://localhost:8443> (self-signed certificate: accept the warning).
- **Alert emails:** <http://localhost:8026> (Mailpit).
- **Demo catalogue:** load it from the repository's seed. It needs the photos folder, which isn't in the image, and `APP_ENV=development`, because the seed refuses any other environment:

  ```sh
  docker run --rm --network duis_backend --env-file .env.production -e APP_ENV=development \
    -e INTERNAL_REVALIDATE_URLS=http://web_a:3000,http://web_b:3000 \
    -e DATABASE_URL="postgres://duis_app:$(grep ^DUIS_APP_PASSWORD= .env.infra | cut -d= -f2)@postgres:5432/duis" \
    -e MEDIA_ROOT=/data/media -e STORAGE_PRIVATE_ROOT=/data/private \
    -v duis_media:/data/media -v "$PWD/src/db/seed/photos:/seed/src/db/seed/photos:ro" \
    -w /seed "duis-web:$(cat state/deployed_sha)" node /app/dist/seed.mjs
  ops/compose restart web_a web_b    # the seed bypasses the app, so clear its in-memory caches
  ```

Everything in the other runbooks works the same here:
- `ops/rollback.sh`;
- `ops/backup-now.sh full`;
- `ops/restore.sh --pitr …`;
- `ops/restore-drill.sh`;
- `ops/host-check.sh`.

The ufw and systemd parts (`bootstrap.sh`, `install-timers.sh`) only run
on the server.

Remove it all with `ops/compose down -v` and delete the clone.

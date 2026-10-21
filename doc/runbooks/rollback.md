# Rollback

```sh
ops/rollback.sh          # the build before the current one
ops/rollback.sh <sha>    # any build still in `docker image ls duis-web`
```

It replaces the replicas with the earlier image in the same zero-downtime way
as a deploy. There's no rebuild and no migration, so it takes about a minute
(target: under 2 minutes). It ends with the smoke test.

- **The schema stays as it is.** That's safe because migrations are backwards compatible ([Deploy](deploy.md#migrations-must-be-backwards-compatible)).
- **When a migration damaged data**, rolling back the code isn't enough: see [Restore](restore.md#a-migration-damaged-data).
- **The scripts and Nginx configuration** stay at the newer checkout. Only the application changes.
- **To go forward again:** run `ops/deploy.sh <ref>`.

`deploy.sh` keeps the last five deployed images. For anything older, deploy
that ref instead (it rebuilds).

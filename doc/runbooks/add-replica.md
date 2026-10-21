# Adding a web replica

Try the cheaper steps first (doc/07 §8): a bigger VPS before a third replica.
Each replica needs about 1.5 GB of memory and up to `DATABASE_POOL_MAX`
(10) database connections. Postgres allows 100, so stay under about six
replicas.

1. **`compose.yaml`:**
   - copy the `web_b` service as `web_c` (with `SERVICE_NAME: web_c`);
   - add a `next_cache_c` volume;
   - add `http://web_c:3000` to `INTERNAL_REVALIDATE_URLS` in `x-app-env`.
2. **`ops/lib.sh`:** add `web_c` to `WEB_SERVICES`. Nginx's upstream list is generated from it.
4. Commit, let CI pass, then `ops/deploy.sh <ref>`.

   The new replica starts with the deploy, and Nginx picks it up on reload.
   Each replica keeps its own page cache; publishing in the CMS clears all of
   them through the worker (ADR-008).

Removing one is the reverse. Remove it from `WEB_SERVICES` first,
then deploy, then run `ops/compose rm -sf web_c`.

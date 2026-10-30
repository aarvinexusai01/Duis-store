# Cache and search (Redis, Elasticsearch, Nginx cache)

Phase 9 (ADR-0033) added three caches. None of them holds anything that
isn't also in Postgres, so the shop keeps working when one fails, only
slower under load. Commands run on the server as `deploy` from `/srv/duis`.

## "Shared cache (Redis)" is failing

What customers notice: nothing, unless traffic is heavy. Pages are built
from Postgres, and product pages read stock from Postgres.

1. `ops/compose ps redis` and `ops/compose logs --tail 50 redis`.
2. Restart it: `ops/compose up -d redis`. It starts empty, and both web
   replicas and the worker reconnect on their own (look for "redis
   connection restored" in `ops/compose logs web_a`).
3. Out of memory: `ops/compose exec redis redis-cli info memory`. The cap is
   `REDIS_MAXMEMORY` (512mb), and entries are evicted as needed, so a full
   Redis is normal. Raise the cap (and `REDIS_MEMORY`) only if
   `evicted_keys` climbs fast during normal traffic.

## "Product search (Elasticsearch)" is failing

What customers notice: search and the search box work, from Postgres, so
results are a little less forgiving of typos.

**Unreachable:**
1. `ops/compose ps elasticsearch` and `ops/compose logs --tail 50 elasticsearch`.
2. Restart it: `ops/compose up -d elasticsearch`. It takes about a minute.
   Search switches back by itself within 30 seconds of it answering.
3. It won't start, and the logs mention `vm.max_map_count`: run
   `sudo sysctl -w vm.max_map_count=262144`. `ops/bootstrap.sh` makes this
   permanent.
4. Its data is damaged: stop it, remove the volume
   (`docker volume rm duis_esdata`), start it, then rebuild the index (below).

**"Changes have waited over 10 minutes":** the worker isn't indexing.
1. Check the worker is healthy: `ops/compose ps worker`.
2. Look for "search indexing failed" in `ops/compose logs --tail 200 worker`.
3. Restart the worker: `ops/compose up -d --no-deps worker`. On start it
   checks the index and works through everything queued.

## Rebuild the search index

Use it after recreating Elasticsearch's volume, or if results look wrong.
Searches keep working throughout: the new index replaces the old one in
one step when it's complete.

```sh
ops/compose run --rm --no-deps worker node dist/search-reindex.mjs
```

On a laptop: `npm run search:reindex`.

## Search results don't show an edit

1. Wait a few seconds: the worker indexes changes within about a second.
2. Check the queue: `ops/compose exec postgres psql -U postgres duis -c
   "select count(*), min(queued_at) from search_index_queue"`. A growing
   count means the worker isn't indexing (see above).
3. Still wrong after the queue is empty: rebuild the index.

## A page shows old content

- **Signed out, for up to 10 seconds:** that's the Nginx page cache, by
  design. `curl -sI https://<site>/products/<slug> | grep -i x-cache-status`
  shows HIT, MISS, EXPIRED or BYPASS.
- **Longer, or when signed in:** the shared cache wasn't invalidated. Check
  for failed `cache.revalidate` jobs on `/admin/system`. Restarting Redis
  empties it as a last resort: `ops/compose restart redis`.
- **Empty the Nginx page cache:** `ops/compose exec nginx sh -c 'rm -rf
  /var/cache/nginx/pages/*'`. Nginx rebuilds it as pages are requested.

## Images on ImageKit (Phase 10)

Uploads go to ImageKit when both settings are present:
`NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` in `.env.infra` (built into the app, so
deploy after changing it) and `IMAGEKIT_PRIVATE_KEY` in `.env.production`.

**Moving existing images** (once, after switching on):

```sh
ops/compose run --rm --no-deps worker node dist/media-to-imagekit.mjs --dry-run
ops/compose run --rm --no-deps worker node dist/media-to-imagekit.mjs
ops/compose exec redis redis-cli FLUSHDB      # cached pages pick up the new links
ops/compose restart web_a && sleep 20 && ops/compose restart web_b
```

It can be run again: images already moved are skipped. The local files stay
on the media volume, so old order lines and a rollback keep working.

**Images don't load:** the browser console shows the cause. A CSP error for
`ik.imagekit.io` means the app was built without the endpoint: deploy again.
A 404 from ImageKit means that image wasn't uploaded; run the move again and
read its FAILED lines.

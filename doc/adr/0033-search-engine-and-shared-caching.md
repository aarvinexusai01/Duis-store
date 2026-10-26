# ADR-0033: Elasticsearch, a shared Redis cache and an Nginx page cache

- Status: Accepted. Built and verified on a laptop 2026-10-23 to 2026-10-26 (9a Redis, 9b Elasticsearch, 9c Nginx cache, 9d proof). Verification on the server waits for the VPS (doc/06 Phase 9).
- Date: 2026-10-23
- Deciders: On 2026-10-23 the owner asked that, as visitors grow, Postgres shouldn't be what serves them: once one visitor has opened a product, everyone after should get it from a cache. They chose:
  - Elasticsearch for search;
  - Redis as a shared cache for everything the storefront already caches;
  - product-page stock in Redis, cleared whenever it changes;
  - Nginx caching static files, plus whole pages for 10 seconds for signed-out visitors with an empty bag.

  This revises ADR-005 ("no Redis") and ADR-011 (Postgres search). The plan is Phase 9 in doc/06.

## Context

- Product details were already cached (`"use cache"`), but in each web replica's own memory. The database filled the same entry once per replica, and every deploy started both replicas empty.
- Stock was read from Postgres on every product view, on purpose, so a sold-out size was never shown as available.
- Every page's header asked for the visitor's bag. For a visitor with no bag, that still read the store settings from Postgres twice per page.

## Decision (9a)

**One shared "use cache" store.** A custom Next.js `cacheHandlers.default` (`src/server/cache/shared-cache-handler.ts`, bundled as `dist/cache-handler.mjs`) keeps entries in Redis.
- **Namespaces:** entries are namespaced by release (`APP_SHA`), so code never reads data shaped by another deploy. Invalidations aren't namespaced, so an admin edit reaches every release running during a rolling deploy.
- **Invalidations:** kept in one Redis hash, merged so a value only ever moves forward, with a version key. `refreshTags()` reads the version once per request and the hash only when it changed.
- **In-memory copy:** each process also keeps a 50 MB in-memory copy of the entries it uses, checked against those invalidations. A hot product needs neither Postgres nor Redis per view.
- **Revalidation fan-out:** ADR-008's fan-out stays. Now that invalidations are shared, it's a second path rather than the only one.
- **`next dev`:** keeps Next's own memory store.
- **`next build`:** never connects to Redis, just as it never connects to Postgres (ADR-016).

**Stock in Redis.** `getCachedAvailability()` (`src/features/inventory/stock-cache.ts`) reads `duis:stock:<variant>`, and falls back to Postgres for misses, which it stores for 30 seconds.
- **Clearing:** a trigger on `inventory_levels` (migration 0017) notifies `duis_stock` with the variant ID after every committed change, whatever made it. The worker's listener (`src/worker/stock-listener.ts`) deletes the key.
- **Location changes:** switching a stock location on or off clears all cached stock.
- **Missed notifications:** a reconnect to Postgres or Redis also clears all cached stock, since notifications sent in between are lost.
- **The 30-second expiry:** it covers the one race we can't close cheaply. A view that read Postgres just before a sale committed can write the old number back after the listener cleared it.
- **Overselling:** checkout never reads this cache. It reserves against the stock rows under a lock (ADR-0032), so overselling stays impossible. The worst case is "in stock" shown for up to 30 seconds after the last unit sold.

**An empty bag costs no query.** `getCart` returns an empty view without reading the store settings when the visitor has no bag. The free-shipping nudge only shows with items in the bag.

**Redis settings:** Redis 8.10, password set through a config file in memory (not the process list), and the private `backend` network only.
- **Memory:** a 512 MB cap. The policy is `volatile-lru`: every cache entry has a TTL and can be evicted, while the invalidation hash, which has none, never is.
- **No saving to disk:** losing Redis loses only cache.

**Failure behaviour.** Redis is optional at every step:
- commands fail fast while it's unreachable, with no queue and a 250 ms timeout;
- the handler carries on from memory, and invalidations it couldn't write are sent once Redis is back;
- stock is read from Postgres;
- the System page shows "Shared cache (Redis)" as failing;
- deploys warn but carry on.

## Decision (9b): Elasticsearch

**What's indexed.** One document per product that's for sale, in an index behind the alias `duis-products` (`src/features/catalog/search/`). It holds:
- **Text:** the title, subtitle, `search_keywords` (category names, attribute labels, tags) and the description text. This is the same text the Postgres search uses.
- **Filter fields:** the same ones as `product_listing_cache`.
- **The product card itself,** so a search page reads nothing from Postgres.

**How text is matched.**
- **Normalising:** "t-shirt", "t shirt", "track pants", "sweat shirt" and "crew neck" become single words before indexing.
- **Synonyms:** applied when products are indexed rather than to the query, so typo tolerance still works on every search word. Examples: tee = t-shirt, hoody = hoodie, joggers = track pants, denim = jeans.
- **Typos:** one is allowed in words of 4 or more letters, two in words of 7 or more. Every word must match.
- **Ranking:** title matches rank first.
- **The search box:** uses a search-as-you-type field, so "overs" finds "Oversized…".

**Filters and counts match Postgres exactly.**
- One request returns the page, the total, every filter's counts and the price range.
- Each filter's counts leave out that filter's own selection, as the Postgres listing does.
- Both engines share the shaping code (`shapeFacets`). A test checks that, for the same query and filters, both give identical products, totals, counts, price ranges and cards.

**Keeping it in sync.**
- **Triggers** on `products`, `product_listing_cache`, `product_variants`, `attribute_values` (labels) and `media_assets` (alt text, files) add affected products to `search_index_queue` (migration 0018) and notify `duis_search`.
- **The worker's indexer** wakes on the notification, waits 250 ms so a burst becomes one batch, and sends the batch. It also sweeps every 30 seconds.
- **The queue is a table, not just a notification,** so nothing is lost while the worker or Elasticsearch is down.
- **A nightly job** (`search.reconcile`) compares the index with Postgres and queues any difference.
- **Full rebuilds** (`npm run search:reindex`, or automatically when `MAPPING_VERSION` changes) build a new index and switch the alias in one step, then re-queue everything to catch changes made meanwhile.

**Failure behaviour.** A search outage must not become a database outage.
- **Unreachable:** when Elasticsearch can't be reached, searches use Postgres and skip Elasticsearch for 30 seconds.
- **Slow:** a timeout (5 s, `ELASTICSEARCH_TIMEOUT_MS`) falls back for that one search only. Three in a row count as an outage. The first version used a 1.5 s timeout and treated any timeout as an outage. Under load on a laptop, that sent every search to Postgres just when the server was busiest. The load check found it.
- **A ceiling on fallback searches:** each web process runs at most 4 Postgres searches at once. Beyond that, the page says "Search is busy right now. Please try again in a moment", and the search box shows only matching categories. With Elasticsearch stopped and 40 searches at once, 11 were answered from Postgres and 29 were told to try again, with no errors.
- **Without Elasticsearch configured,** Postgres is the search engine, with no limit.
- The System page shows "Product search (Elasticsearch)" failing when it's unreachable, or when changes have waited more than 10 minutes to be indexed.
- Deploys warn but carry on.

**Server settings.**
- Elasticsearch 9.5.5, single node, security on (the `elastic` user, password in `.env.infra`), plain HTTP on the private `backend` network only.
- Automatic index creation is off. All Linux capabilities are dropped.
- 1 GB heap, 2 GB memory limit. The host needs `vm.max_map_count = 262144` (set by `ops/bootstrap.sh`).
- **No backups:** the index is a copy of Postgres, so it isn't backed up.

**Fixed along the way.**
- Renaming an attribute value (for example a colour) didn't revalidate cached listings or product pages, and didn't refresh `search_keywords`. Now it does both.
- `requestRevalidation` now splits more than 200 tags into several jobs. The replicas refuse larger requests, so a colour used by more than 200 products would have failed forever.

## Decision (9c): Nginx cache

**Whole pages, for 10 seconds** (`docker/nginx/page-cache.conf`).
- **Which pages:** home, shop, products, collections, search, journal, content pages, policies, about, FAQ, contact and the size guide (`GET`/`HEAD` only).
- **Who skips it:** visitors with the bag cookie (`duis_cart`) or a Better Auth cookie (`duis.*`), and the app's in-app navigation requests (`RSC`). The cookie-banner choice is read in the browser, so it doesn't stop caching.
- **Never stored:** a response that sets a cookie.
- **One request per page:** while a page is fetched, other visitors wait for that copy (`proxy_cache_lock`).
- **Expiry:** an expired copy is served while a fresh one is fetched in the background.
- **Outage:** if both replicas are down, the last copy is served instead of an error.
- **Browsers and Cloudflare** still get Next's `private, no-store`: only Nginx keeps a copy.
- `X-Cache-Status` shows HIT, MISS, STALE, UPDATING or BYPASS.

**Build files** (`/_next/static/`, hashed names) are kept for a week.

**Where the cache lives:** the `nginx_cache` volume, not the in-memory `/tmp`, where cached pages would count against Nginx's 256 MB memory limit.

**After deploys,** `ops/smoke-test.sh` checks that a product page is cached, that a visitor with a bag skips the cache, that the bag is never cached, and that search answers.

## Measured on a laptop (2026-10-26)

**Setup.** Production build; two replicas with Redis and Elasticsearch, behind the production Nginx config in its container; a third replica with neither, as "before"; dev database (66 products). Counts are Postgres transactions, read 11 s after each wave once the statistics had settled, so earlier waves aren't counted. With nothing happening, the background is about 3 transactions per window.

| Requests | Postgres per request, before Phase 9 | After, at the app | After, signed out through Nginx |
|---|---|---|---|
| Product page (10 products, 600–2,000 requests) | 1.03 | 0.05 | 0.01 |
| Search (10 queries, 300–1,000 requests) | 9.05 | 0.02 | 0.01 |

**Latency at the app,** median: product pages 156 → 89 ms; search 174 → 163 ms. Through Nginx the times include a new TLS connection per request from curl on the same laptop, so they're not comparable.

**Spike:** 300 simultaneous requests for a page nobody had opened yet. All answered 200, and 1 reached the app.

**Earlier checks:**
- **One product, opened once on replica A, then viewed 100 times on replica B:** 4 Postgres transactions in total, the same as the background noise in the same time. Statement logging confirmed **zero queries for 40 views across both replicas**, and zero for 60 warm searches.
- **An invalidation sent to replica A only:** replica B showed the edit on its next request.
- **Redis stopped:** every page still answered 200, in about 0.1 s, from Postgres. **Redis restarted:** both replicas reconnected and refilled on their own.
- **Elasticsearch stopped:** searches used Postgres, within the ceiling above. **Elasticsearch restarted:** search returned to it on its own within 30 s.

## Measured on the first day (2026-10-23, production build, two replicas, dev database)

- **One product, opened once on replica A, then viewed 100 times on replica B:** 4 Postgres transactions in total, the same as the background noise in the same time. Statement logging confirmed **zero queries for 40 views across both replicas**.
- **An invalidation sent to replica A only:** replica B showed the edit on its next request.
- **Redis stopped:** every page still answered 200, in about 0.1 s, from Postgres. **Redis restarted:** both replicas reconnected and refilled on their own.

## Consequences

- **More moving parts:** Redis is one more container to watch (System page, `/api/health/ops`). The app degrades to the old behaviour without it rather than failing.
- **More memory:** about 2.6 GB more on the server (Elasticsearch about 2 GB, Redis 0.6 GB). 8 vCPU / 16 GB becomes the minimum, and Postgres gets 3 GB of shared buffers instead of 4 (doc/07 §1).
- **More moving parts to watch:** Elasticsearch and the search queue are on the System page as well. Runbook: [cache and search](../runbooks/cache-and-search.md).
- **Development:** `npm run db:up` starts Redis and Elasticsearch (512 MB heap). Integration tests use their own Redis database (15) and their own index, both emptied every run. E2E's two replicas and worker share Redis and the dev index, as production does. `npm run search:reindex` builds the dev index.
- **Signed-out visitors may see a page up to 10 seconds old.** Stock and prices are still checked at add-to-bag and checkout.
- **`npm run build`** now builds `dist/` (including the cache handler) before `next build`.
- **Revisit:**
  - when a third replica or a second server arrives (the handler already works across any number of processes on one Redis);
  - if searches stop fitting in one Elasticsearch shard (far beyond 5,000 products);
  - if the 10-second page cache needs to be longer, which would need purging on edits that open-source Nginx doesn't offer.

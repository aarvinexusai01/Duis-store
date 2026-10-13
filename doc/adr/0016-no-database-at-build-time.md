# ADR-0016: No database access at build time

- Status: Accepted
- Date: 2026-10-13

## Context

With Cache Components, `next build` prerenders each route's static shell, and `"use cache"` functions **execute during the build** to fill it (Next.js 16.4 docs: *use cache → prerendering*). Our images are built on the server inside `docker build`. That build can't reach the production database (it is on an internal network), and it must never need secrets.

## Decision

1. Builds never touch the database or any secret. Environment validation is lazy (`getServerEnv()`), and `instrumentation.ts` validates at **server start**, skipping the build phase.
2. Any route that reads the database calls `await connection()` (or reads cookies or headers) **before** calling the cached data function. The cached function then fills at request time and is reused from the in-memory cache, invalidated by tags (ADR-008).
3. Layout chrome that is truly static (fonts, footer skeleton) can still be prerendered.

## Consequences

- The first request after a deploy is a cache miss for each cached function. The cache key includes the deployment ID, so a deploy starts cold. The deploy smoke test warms the home page, a listing and a product page.
- `"use cache"` must never be reached during prerender without `connection()` first, or `next build` fails. The Phase 1 data-access helpers will make the safe pattern the default.
- No build-time database snapshot, so there is no stale catalogue baked into the image.

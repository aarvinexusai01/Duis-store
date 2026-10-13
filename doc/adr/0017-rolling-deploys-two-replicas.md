# ADR-0017: Rolling deploys with two replicas

- Status: Accepted (Phase 0 sets the build inputs; Phase 7 implements the rest)
- Date: 2026-10-13

## Context

During a rolling deploy, `web_a` (new build) and `web_b` (old build) serve traffic at the same time. The Next.js 16.4 self-hosting guide lists what breaks across instances: Server Action encryption, version skew, static assets that exist in only one build, and `revalidateTag()` only reaching the instance that calls it.

## Decision

| Concern | Measure | Where |
|---|---|---|
| Server Action closures encrypted per build | Same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` for every build, passed as a BuildKit secret | Dockerfile (done); `deploy.sh` (Phase 7) |
| Version skew | `NEXT_DEPLOYMENT_ID` = git SHA at build. Next adds `?dpl=` to assets, checks `x-deployment-id` and forces a hard reload on mismatch. | Dockerfile (done) |
| Static chunks missing on the other replica | `deploy.sh` copies each build's `.next/static` into a shared `next_static` volume (kept for the last 5 builds). Caddy serves `/_next/static/*` from it with immutable caching. | Phase 7 |
| Tag invalidation per instance | Keep ADR-008's fan-out to `/api/internal/revalidate` on every replica. Next's documented alternative is a custom `cacheHandlers` handler implementing `refreshTags()` against shared storage. A Postgres `LISTEN/NOTIFY` handler is the upgrade path, with no Redis needed. | Phase 1 |
| HTML caching at Cloudflare | Static pages are sent with `Cache-Control: s-maxage=31536000`. Cloudflare must **bypass cache for HTML**, or purge on deploy and on CMS publish. Only `/_next/static/*` and `/media/*` are cached at the edge. | Phase 7 |
| Graceful drain | `stop_grace_period: 30s`. Next finishes in-flight requests and `after()` work on SIGTERM. The worker drains jobs; this is tested. | Phase 7 |

## Consequences

A deploy causes at most one hard reload for a client that straddles versions, and never a missing chunk or a broken Server Action. The checks in 07 §4 verify this under load.

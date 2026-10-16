# 02 — Architecture

## 1. System context

```
                 Customers / Staff (browsers)
                            │ HTTPS
                            ▼
                ┌────────────────────────┐
                │ Cloudflare (proxy, WAF,│  DNS, DDoS, edge cache for /media and
                │ Turnstile, edge cache) │  /_next/static, bot protection
                └───────────┬────────────┘
                            │ HTTPS (Origin CA cert, Full strict)
┌───────────────────────────┼──────────────────────────────────────────┐
│ VPS (Ubuntu LTS, Docker)  ▼                                          │
│                  ┌─────────────────┐                                 │
│  network: edge   │ caddy           │ TLS, security headers, body     │
│                  │                 │ limits, real-IP, /media static  │
│                  └──┬───────────┬──┘                                 │
│                     │ LB + health checks                             │
│              ┌──────▼───┐   ┌───▼──────┐                             │
│              │ web_a    │   │ web_b    │  Next.js 16 (standalone)    │
│              │ storefront / admin / cms / api / webhooks            │
│              └──┬───────┘   └───┬──────┘                             │
│  network:       │   ┌───────────┘   ▲ POST /api/internal/revalidate  │
│  backend        │   │               │ (fan-out to every replica)     │
│  (internal)  ┌──▼───▼─────┐   ┌─────┴──────┐                         │
│              │ postgres 18│◄──┤ worker     │ pg-boss jobs: payments, │
│              │ (+pgBackRest)  │ (same image│ reservations, shipping, │
│              └──────┬─────┘   │  as web)   │ notifications, CMS      │
│                     │         └────────────┘ scheduling, cleanup     │
│   volumes: pgdata, media, pgbackrest spool, caddy data               │
└─────────────────────┼────────────────────────────────────────────────┘
                      │ encrypted backups
                      ▼
            S3-compatible bucket (B2 / R2 / S3)

Outbound integrations (from web and worker):
Razorpay · Shiprocket · SMTP email · WhatsApp BSP · SMS (OTP, DLT) ·
Google OAuth · Meta Conversions API · Sentry-compatible error tracking
```

## 2. Architectural style

- **Modular monolith.** One Next.js codebase, one deployable image, one database. Domain modules (`catalog`, `inventory`, `orders`, `cms`, …) have explicit public interfaces. No microservices.
- **Two runtime processes from one image:**
  - `web` serves HTTP and runs as two replicas.
  - `worker` runs background jobs.
  Both share the same domain services.
- **Server-side business rules.** Prices, discounts, tax, stock, eligibility and payment status are only ever calculated on the server. The client gets display data and sends user intent.
- **Vertical slices.** Each feature ships end to end: schema → service → action → UI → tests. Nothing is built as an isolated mock.

### Layering (dependencies point downward only)

```
app/ (routes, layouts, pages)          UI composition, data loading for rendering
   │
features/<domain>/actions|routes       thin: authenticate → authorize → validate (Zod) → call service
   │
features/<domain>/service              business rules, transactions, state machines, emits jobs/events
   │
features/<domain>/repository           Drizzle queries only (no business rules)
   │
server/db, server/integrations/*       infrastructure: DB client, Razorpay, Shiprocket, mail, storage…
```

Rules:
1. A domain may call another domain only through that domain's `service` (or exported query functions), never its repository.
2. Integrations are hidden behind interfaces (`PaymentGateway`, `ShippingProvider`, `MessageChannel`, `StorageAdapter`, `AnalyticsSink`), and each has a fake implementation for development and tests.
3. Every service entry point receives an `ActorContext` (user, roles, request ID, IP) and enforces permissions itself. Route-level checks are only a convenience, never the security boundary.

## 3. Technology stack

Versions are the `latest` npm tags on 2026-10-13. Phase 0 pins exact versions in `package-lock.json`.

| Concern | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node.js LTS | 24.x (local is 24.16) | Active LTS. Move to Node 26 after it becomes LTS (expected late Oct 2026) and Next.js supports it. This is a one-line change in `.nvmrc` and the `Dockerfile`. |
| Framework | Next.js App Router | 16.4.0 | Required by the spec. Provides Cache Components (`"use cache"`, `cacheTag`, `cacheLife`), `proxy.ts`, Turbopack and standalone output. |
| UI library | React | 19.3 | Comes with Next 16. |
| Language | TypeScript | 5.x | TypeScript 7 works for `next build`, but its missing JavaScript compiler API breaks `typescript-eslint` (ADR-014). |
| Styling | Tailwind CSS | 4.3 | Required by the spec. Uses CSS-first config and design tokens as CSS variables. |
| Components | shadcn/ui (CLI 4.x, Base UI, preset `base-nova`) | 4.21 | Required by the spec. We own the copied component source. Base UI is the CLI's default base (ADR-014). |
| Database | PostgreSQL | 18 | Self-hosted. Native `uuidv7()`, JSONB, full-text search, `ltree`, `pg_trgm`. |
| ORM and migrations | Drizzle ORM / drizzle-kit | 0.45.4 / 0.31.11 | Stable line. 1.0 is still a release candidate; upgrade once it is stable (ADR-014). |
| Server bundles | esbuild | 0.28 | Bundles the worker and migrate entry points into `dist/` (ADR-014). |
| DB driver | `pg` (node-postgres) | 8.23 | One driver shared by Drizzle, Better Auth and pg-boss. |
| Validation | Zod | 4.6 | Every boundary: forms, actions, route handlers, webhooks, CMS blocks, environment variables. |
| Auth | Better Auth | 1.7.7 | See §4.2. |
| Background jobs | pg-boss | 12.37 | Job queue stored in Postgres: retries, cron, singleton jobs, dead-letter queues. No Redis. |
| Rich text (CMS, product descriptions) | Tiptap | 3.31 | Stores structured JSON. Rendered server-side through an allow-list. |
| Drag and drop | dnd-kit (`core` 6.3, `sortable` 10) | — | Reordering CMS sections, menus, product media and collection products. |
| Forms | react-hook-form + Zod resolver | 7.90 | Accessible forms with server re-validation. |
| Admin tables | TanStack Table | 9.3 | Server-side pagination, filtering, sorting and bulk selection. |
| Images | sharp | 0.35 | Upload sanitisation (re-encode, strip metadata) and pre-generated responsive WebP sizes. |
| Email | Nodemailer (SMTP) + React Email | 10.1 / 1.0 | Works with any SMTP provider. Templates are React components. |
| Logging | pino | 10.4 | Structured JSON logs carrying request IDs. |
| Error tracking | `@sentry/nextjs` SDK | — | Sends to Sentry SaaS or a self-hosted GlitchTip; the choice is a config change. |
| Payments | Razorpay Node SDK | 2.9.8 | Official SDK. Server-side orders, refunds, signature verification. |
| Shipping | Shiprocket REST API (own client) | — | Behind the `ShippingProvider` interface. |
| Unit and integration tests | Vitest | 5.0 | Integration tests use a real PostgreSQL in Docker. |
| End-to-end tests | Playwright + axe-core | 1.64 | Customer, admin and CMS journeys, plus accessibility checks. |
| Reverse proxy | Caddy | 2.x | Simple config, automatic HTTPS, active health checks, load balancing. |
| Containers | Docker Engine + Compose v2 | 28.x / 2.40 | Self-hosted, reproducible. |

## 4. Evaluations and choices

### 4.1 Database: plain PostgreSQL, no Supabase
Plain PostgreSQL with Drizzle covers everything we need: relational integrity, transactions, row locks, JSONB, full-text search, and a job queue (pg-boss). Supabase would add Kong, GoTrue, PostgREST, Realtime and Storage containers that we wouldn't use, because auth, storage and APIs are owned by the application. That means more RAM, more upgrades and more attack surface, with no feature we need. **Decision: no Supabase.**

### 4.2 Authentication: Better Auth
- Auth.js (NextAuth) has been maintained by the Better Auth team since September 2025, and they recommend Better Auth for new projects.
- Better Auth covers every requirement:
  - Email and password, with email verification and password reset
  - Phone-number OTP, via the `phoneNumber` plugin
  - Google sign-in
  - Sessions stored in the database
  - An `admin` plugin with roles, bans and session revocation
  - Typed access control through `createAccessControl`
  - TOTP two-factor authentication
  - Built-in rate limiting with database storage, which is shared across replicas
  - A Drizzle adapter and a `nextCookies` plugin for Server Actions
- Password hashing, session tokens and CSRF protection are handled by the library, not written by us.
- **Decision: Better Auth for customers and staff alike, so storefront, admin and CMS share one auth system.**

### 4.3 CMS: custom, inside the app (your decision)
- **Payload 3.90:** a capable choice that now supports Next 16. We rejected it because it would mean a second user/auth system, a second migration system, a different admin UI, references to products and collections that the database can't enforce, and an upcoming 4.0 major version.
- **Directus:** rejected because it needs an extra service, a second admin app, and has a BSL licence.
- **What we build instead:** the custom CMS reuses mature libraries (Tiptap, dnd-kit, shadcn/ui, Zod) and our own job queue and media pipeline. CMS content is stored as **typed, Zod-validated JSON blocks** inside revisions. Every block reference to a product, collection, category or media item is also stored in **reference tables with real foreign keys**. That gives database integrity and safe deletion. See [05-database-design.md](05-database-design.md#11-cms).

### 4.4 Media storage: local volume now, S3-compatible later
- **Choice:** files go to a persistent Docker volume, are served by Caddy at `/media/*` with long-lived immutable cache headers, and are cached at Cloudflare's edge.
- **Why not MinIO:** its community edition stopped publishing images in October 2025 and is now maintenance-only or archived, so we don't use it.
- **Future option:** a `StorageAdapter` interface (`local` now, `s3` later) means we can move to Cloudflare R2, Backblaze B2, Garage or SeaweedFS if we ever run more than one server.
- **Upload pipeline:**
  1. Size limit
  2. Magic-byte check (JPEG, PNG, WebP or AVIF only; no SVG)
  3. Pixel limit
  4. sharp re-encode, which strips EXIF data and defeats polyglot files
  5. Pre-generated WebP widths (320, 640, 960, 1280, 1920)
  6. A content-hashed storage key
- `next/image` uses a **custom loader** that picks the nearest pre-generated width. Resizing never happens at request time, so there are no CPU spikes during sales.

### 4.5 Background jobs: pg-boss in a dedicated worker
- Jobs live in Postgres, in their own `pgboss` schema, so they are durable and included in backups.
- pg-boss provides cron scheduling, retries with backoff, singleton keys, dead-letter queues and archive retention.
- Jobs are queued inside the same database transaction as the business change, using pg-boss's `fromDrizzle(tx, sql)` adapter. No outbox table is needed; this is verified by an integration test (ADR-015).
- No business-critical timer ever runs in memory.

Job catalogue (initial):

| Queue | Trigger | Purpose |
|---|---|---|
| `inventory.expire-reservations` | cron, every minute | Release expired checkout reservations |
| `payments.process-webhook` | on webhook receipt | Apply Razorpay events idempotently |
| `payments.reconcile` | cron, every 15 min | Fetch payment status for pending orders that never received a webhook |
| `orders.post-confirmation` | order confirmed | Notifications, analytics events, sales statistics |
| `shipping.create-shipment` | admin action | Create the Shiprocket order, AWB and label, with retries |
| `shipping.process-webhook` / `shipping.sync-tracking` | webhook / cron | Tracking updates, with polling as a fallback |
| `cod.reconcile-remittance` | cron, daily | Mark COD balances as collected |
| `notify.email` / `notify.whatsapp` / `notify.sms-otp` | various | Deliver messages, retry and log them |
| `cms.publish-scheduled` | cron, every minute | Publish due revisions, then revalidate |
| `cache.revalidate` | after publish or catalogue change | Send tag invalidation to every web replica |
| `catalog.refresh-auto-collections` | product, price or stock change; nightly | Rebuild automatic collection membership |
| `catalog.refresh-sales-stats` | hourly | Best sellers and trending ranks |
| `marketing.abandoned-cart` | cron, every 15 min | Send cart reminders (respects consent) |
| `marketing.back-in-stock` | stock goes from 0 to above 0 | Notify subscribers |
| `analytics.meta-capi` | purchase and other events | Send server-side events (respects consent) |
| `maintenance.cleanup` | cron, nightly | Expired sessions, idempotency keys, stale carts, orphaned uploads |

### 4.6 Search
- PostgreSQL full-text search on a weighted `tsvector` (title A, category and tags B, description C), with `unaccent`.
- `pg_trgm` adds typo tolerance and autocomplete.
- Filters and facets come from indexed variant and attribute tables.
- This comfortably handles 5,000 products. A `SearchProvider` interface keeps Meilisearch available as a later option.

### 4.7 Reverse proxy: Caddy
- **Why Caddy over Nginx and Traefik:** the simplest config for TLS, security headers, active health checks across two upstreams, `lb_try_duration` (so requests wait instead of failing while a replica restarts), request-body limits per path, and trusted-proxy real IPs.
- **TLS behind Cloudflare:** we use a Cloudflare Origin CA certificate.

## 5. Rendering, caching and revalidation

Next.js 16 **Cache Components** are enabled (`cacheComponents: true`).

| Content | Strategy |
|---|---|
| Home, collection and category listings, PDP content, blog, CMS pages, navigation, site settings | `"use cache"` + `cacheTag(...)` + `cacheLife(...)`. Static shell with dynamic holes. |
| Live variant availability on the PDP, cart badge, auth state | Dynamic, streamed inside `<Suspense>`, never cached |
| Cart, checkout, account, admin, CMS editor | Fully dynamic (per user) |
| Final prices, stock and eligibility during checkout | Always re-read inside the checkout transaction, never from cache |

**Tag naming:**
- Catalogue: `product:{id}`, `products:list`, `category:{id}`, `collection:{id}`
- CMS: `cms:page:{slug}`, `cms:nav`, `cms:settings`, `blog:post:{slug}`, `blog:list`

**Invalidation:**
1. An admin or CMS change commits, then queues `cache.revalidate` with the affected tags.
2. The worker resolves every `web` replica through Docker DNS and calls `POST /api/internal/revalidate` on each one. The endpoint is reachable only on the internal network and requires a shared HMAC secret. Each replica then runs `revalidateTag(tag, 'max')`.
3. If the editor made the change on the same replica, the Server Action also calls `updateTag(...)`, so the editor sees their own change immediately.
4. As a safety net, `cacheLife` keeps the worst-case staleness bounded (for example, catalogue entries expire within one hour).

The result is that published CMS changes appear within seconds, with no rebuild and no redeploy.

**Fallback:** if fanning out to each replica proves fragile, we switch to a shared Next.js cache handler that implements `refreshTags()`. It can be backed by Postgres `LISTEN/NOTIFY`, so it needn't bring in Redis (ADR-017).

**Two constraints found in Phase 0:**
- `next build` runs `"use cache"` functions to prerender static shells, but our builds have no database. Database-backed routes therefore call `connection()` first and fill their caches at request time (ADR-016).
- Static pages are sent with a one-year `s-maxage`, so Cloudflare must bypass HTML caching, or purge on deploy and on CMS publish (ADR-017).

## 6. Integration interfaces

| Interface | Implementations | Notes |
|---|---|---|
| `PaymentGateway` | `razorpay`, `fake` | Create order, verify checkout signature, verify webhook, fetch payment, refund |
| `ShippingProvider` | `shiprocket`, `fake` | Serviceability (with estimated delivery date and COD flag), create order, assign AWB, label, pickup, track, cancel, reverse pickup (for exchanges) |
| `MessageChannel` | `email-smtp`, `whatsapp-<bsp>`, `sms-<provider>`, `console` | Template-based. Every send is logged in `notification_logs`. |
| `StorageAdapter` | `local`, `s3` (later) | Public media and private files (exports) are kept apart |
| `AnalyticsSink` | `meta-capi`, `noop` | Respects consent. Shares an `event_id` with the Pixel so Meta can deduplicate. |
| `SearchProvider` | `postgres`, `meilisearch` (later) | — |

Each provider is chosen through environment variables. Development and CI default to the fakes, so the app runs fully without any external accounts.

## 7. Cross-cutting conventions

- **IDs:** `uuid` primary keys defaulting to `uuidv7()`, which are time-ordered and index-friendly. Human-facing numbers (order number, exchange number) come from separate Postgres sequences.
- **Money:** integer paise in `integer` or `bigint` columns, in TypeScript a `Money` value type, and display formatting through `Intl.NumberFormat('en-IN', { currency: 'INR' })`. Never floats.
- **Time:** stored as `timestamptz` in UTC and displayed in `Asia/Kolkata`.
- **Idempotency:** every externally triggered or retryable mutation (payment verification, webhooks, refunds, wallet entries, shipment creation, placing an order) uses a unique idempotency key enforced by a database constraint.
- **State machines:** order, payment, shipment, exchange and CMS revision statuses change only through one function per machine that validates the allowed transitions and writes history rows.
- **Errors:** services throw typed `DomainError`s (`OUT_OF_STOCK`, `COUPON_INVALID`, …). Actions map them to user-safe messages. Unexpected errors are logged with the request ID and sent to Sentry.
- **Audit:** every staff mutation writes to `audit_logs` (who, what, before and after, IP, request ID) inside the same transaction.
- **Configuration:** environment variables are validated at startup with Zod (`src/config/env.ts`). The process refuses to start if any are missing or invalid.

## Decision log

| ID | Decision | Status |
|---|---|---|
| ADR-001 | Modular monolith on Next.js 16 App Router, two processes (web, worker) from one image | Accepted |
| ADR-002 | Plain PostgreSQL 18 + Drizzle; no Supabase | Accepted |
| ADR-003 | Better Auth for all users; roles and permissions defined in code; staff two-factor required | Accepted |
| ADR-004 | Custom CMS on the shared schema; JSON block revisions plus foreign-key reference tables | Accepted (business decision) |
| ADR-005 | pg-boss job queue in a dedicated worker; no Redis | Accepted |
| ADR-006 | Local media volume with sharp pre-generated widths; `StorageAdapter` for future S3 | Accepted |
| ADR-007 | Caddy behind Cloudflare (Origin CA, Full strict, origin firewall limited to Cloudflare) | Accepted |
| ADR-008 | Two web replicas with cache-tag fan-out revalidation | Accepted, revisit after load test |
| ADR-009 | Integer paise for all money; GST included in prices; tax lines saved per order line | Accepted |
| ADR-010 | Partial COD: advance via Razorpay, balance as the COD amount sent to Shiprocket | Accepted, **⚠ verify Shiprocket fields** |
| ADR-011 | Postgres full-text search + `pg_trgm`; `SearchProvider` interface | Accepted |
| ADR-012 | Build on the server; images tagged by git SHA; rollback without rebuild | Accepted (business decision) |
| ADR-013 | Drizzle 0.45 stable at start; evaluate 1.0 when it is stable | Closed by ADR-014 (stay on 0.45) |
| [ADR-014](adr/0014-phase-0-toolchain-baseline.md) | Toolchain: TypeScript 5, ESLint 9, Drizzle 0.45, shadcn on Base UI, esbuild for server bundles | Accepted (Phase 0) |
| [ADR-015](adr/0015-job-queue-and-database-roles.md) | Jobs queued inside transactions via `fromDrizzle`; `pgboss` schema owned by the runtime role | Accepted, tested |
| [ADR-016](adr/0016-no-database-at-build-time.md) | No database or secrets at build time; database-backed rendering behind `connection()` | Accepted |
| [ADR-017](adr/0017-rolling-deploys-two-replicas.md) | Rolling deploys: deployment ID, stable Server Actions key, shared static assets, HTML bypass at Cloudflare | Accepted (Phase 7 completes it) |
| [ADR-018](adr/0018-worldwide-shipping-inr-only.md) | Worldwide shipping at launch; INR only; international orders prepaid only | Accepted (business decision), details open |
| [ADR-019](adr/0019-phase-1-implementation-decisions.md) | Phase 1: operation wrapper and registry, worker-only email rendering (no React Email), `expire: 0` revalidation, `stately` refresh queue, media layout, catalogue model, test database per run | Accepted (Phase 1) |
| [ADR-020](adr/0020-phase-2-storefront-decisions.md) | Phase 2: brand tokens, partial prerendering with request-time islands, what is and isn't cached, hashed guest-cart token merged at `/auth/complete`, auth via the Better Auth HTTP client, fake shipping provider refused in production, double opt-in newsletter | Accepted (Phase 2) |
| [ADR-021](adr/0021-phase-3-checkout-decisions.md) | Phase 3: pure pricing engine and quote hash, single-transaction placement with idempotency key, wallet lots with promotional expiry, one idempotent payment settlement path, gateway check before expiry, idempotent refunds, fake gateway for tests | Accepted (Phase 3) |
| [ADR-022](adr/0022-phase-4a-admin-decisions.md) | Phase 4a: `requireStaff` guard (404 for non-staff, 2FA enrolment), URL-driven server tables, Tiptap limited to the sanitizer's subset, stock changes only as movements, category up/down ordering, rule preview shares the refresh query, financial figures gated by `order: read_financials` | Accepted (Phase 4a) |
| [ADR-023](adr/0023-phase-4b-orders-shipping-decisions.md) | Phase 4b: courier boundary with a fake provider and an unverified Shiprocket client, resumable parcel booking with a lease, forward-only tracking from webhook/poll/demo scans, parcel → order listener, staff cancel via the courier first, refunds capped at what was collected, COD remittance CSV with exact matching, per-code coupon limits, IST dates | Accepted (Phase 4b) |
| [ADR-024](adr/0024-phase-4c-administration-decisions.md) | Phase 4c: sectioned, audited settings with a `store:settings` cache tag (product page and bag read settings), date-ranged tax rules by IST date, optional emails and sender only, single-use 72-hour staff invitations, always another active 2FA Super Admin, system page with summarised job data, refunds through the paying gateway, GST CSV that adds up to order totals, formula-safe CSVs, command palette and column visibility | Accepted (Phase 4c) |
| [ADR-025](adr/0025-phase-5a-exchanges-reviews-decisions.md) | Phase 5a: exchange lifecycle and eligibility, replacement held from approval (`exchange_out`/`exchange_in`), price difference through the normal settlement path or as wallet credit after QC, return and replacement parcels on the same courier pipeline, private customer photos, signed tracking links, moderated verified reviews with rating summaries | Accepted (Phase 5a) |

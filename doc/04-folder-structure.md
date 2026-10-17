# 04 — Folder Structure

The repository root is `Duis-store/`. It is a single npm package (no workspaces) holding a modular monolith. The structure below is the **target**. Phase 0 creates the skeleton, and each later phase fills in its own folders.

## 1. Repository root

```
Duis-store/
├── .github/
│   ├── workflows/ci.yml            # lint · typecheck · unit · integration (Postgres) · build · e2e
│   ├── dependabot.yml              # weekly npm + Docker base image updates
│   └── pull_request_template.md
├── doc/                            # this plan (01–10), adr/, runbooks/
│   ├── adr/                        # one file per significant decision (NNNN-title.md)
│   └── runbooks/                   # deploy, rollback, restore, incident, secret rotation, go-live
├── docker/
│   ├── caddy/
│   │   ├── Caddyfile               # TLS (Origin CA), headers, limits, LB, /media, internal-route block
│   │   └── cloudflare-ips.txt      # trusted proxy ranges (refreshed by script)
│   ├── postgres/
│   │   ├── Dockerfile              # postgres:18 + pgBackRest
│   │   ├── postgresql.conf         # tuned for 16 GB host; WAL archiving on
│   │   ├── pgbackrest.conf         # S3 repo, retention, encryption (secrets via env)
│   │   └── initdb/
│   │       ├── 01-roles.sh         # duis_owner (DDL), duis_app (DML), duis_readonly
│   │       └── 02-extensions.sql   # pg_trgm, unaccent, ltree, citext
│   └── backup/
│       ├── Dockerfile              # restic + pg_dump client + supercronic
│       └── crontab                 # nightly logical dump + media snapshot, weekly prune/check
├── scripts/
│   ├── server-bootstrap.sh         # Ubuntu hardening, Docker install, firewall (Cloudflare-only 443)
│   ├── deploy.sh                   # build@SHA → migrate → rolling restart → smoke test
│   ├── rollback.sh                 # switch to a previous SHA image (no rebuild)
│   ├── backup-now.sh / restore.sh / restore-drill.sh
│   ├── update-cloudflare-ips.sh
│   ├── smoke-test.sh
│   ├── build-server-bundles.mjs    # esbuild: src/worker + src/db/migrate → dist/*.mjs   (Phase 0 ✓)
│   ├── start-standalone.mjs        # `npm start`: runs .next/standalone like the image  (Phase 0 ✓)
│   └── stubs/server-only.mjs       # `server-only` stand-in for Vitest and the bundles  (Phase 0 ✓)
├── public/                         # static assets only (favicons, manifest icons, og fallback)
├── src/                            # application code (see §2)
├── tests/                          # integration + e2e (unit tests are colocated, see §6)
├── .dockerignore  .editorconfig  .env.example  .gitignore  .nvmrc
├── compose.yaml                    # production stack
├── compose.dev.yaml                # local: postgres (localhost:5432) + mailpit (SMTP catcher)
├── Dockerfile                      # multi-stage: deps → build (next + worker bundle) → runtime
├── components.json                 # shadcn/ui config
├── drizzle.config.ts               # schema: src/db/schema, out: src/db/migrations, schemaFilter: public
├── eslint.config.mjs               # flat config + import-boundary rules
├── next.config.ts                  # standalone output, cacheComponents, images loader, headers
├── playwright.config.ts  vitest.config.mts  tsconfig.json  .prettierrc.json
├── AGENTS.md                       # Next.js agent rules + project rules for coding agents
├── package.json  package-lock.json # npm only (lockfile committed)
└── README.md                       # setup, commands, deploy, troubleshooting
```

## 2. `src/` overview

```
src/
├── app/            # routes only: layouts, pages, route handlers (thin)
├── components/     # design system + cross-domain UI (header, footer, data table…)
├── features/       # domain modules: business logic, queries, actions, domain UI
├── server/         # infrastructure: db client, auth, jobs, cache, integrations, security
├── db/             # Drizzle schema, migrations, seed
├── worker/         # background worker entry + job handlers
├── emails/         # React Email templates
├── lib/            # framework-free utilities (money, dates, slugs, result types)
├── hooks/          # client-side React hooks
├── config/         # env validation, site constants, feature flags
├── types/          # global/shared TypeScript types
├── instrumentation.ts   # Sentry + logger init (Next.js hook)
└── proxy.ts             # Next 16 proxy: request id, CSP nonce, optimistic auth redirects
```

## 3. `src/app/`: routes

Route groups separate layouts and policies without changing URLs.

```
src/app/
├── layout.tsx                         # <html>, fonts (next/font, self-hosted), tokens, consent provider
├── globals.css                        # Tailwind v4 + design tokens (CSS variables)
├── not-found.tsx  global-error.tsx
├── robots.ts  sitemap.ts  manifest.ts
│
├── (storefront)/                      # public shop (header, mega menu, footer, cart drawer)
│   ├── layout.tsx
│   ├── page.tsx                       # home — renders published CMS blocks
│   ├── shop/[[...slug]]/page.tsx      # /shop · /shop/men · /shop/men/t-shirts/oversized
│   ├── collections/page.tsx
│   ├── collections/[slug]/page.tsx
│   ├── products/[slug]/page.tsx       # PDP; variant via ?color=&size=; canonical without params
│   ├── search/page.tsx
│   ├── cart/page.tsx
│   ├── wishlist/page.tsx
│   ├── blog/page.tsx · blog/[slug]/page.tsx · blog/category/[slug]/page.tsx
│   ├── pages/[slug]/page.tsx          # CMS landing pages
│   ├── policies/[slug]/page.tsx       # privacy, terms, shipping, exchange, cancellation
│   ├── about/ · contact/ · faq/ · size-guide/   # CMS pages at friendly URLs (contact adds form)
│   ├── track/page.tsx                 # signed-in tracking lookup; tokenised links from emails
│   └── account/                       # requires session (checked in layout AND services)
│       ├── layout.tsx · page.tsx
│       ├── orders/page.tsx · orders/[orderNumber]/page.tsx        # timeline, cancel
│       ├── orders/[orderNumber]/exchange/page.tsx                  # exchange request flow
│       ├── exchanges/page.tsx · wallet/page.tsx · addresses/page.tsx · reviews/page.tsx
│       ├── profile/page.tsx           # name, email, phone, marketing consent, delete account
│       └── security/page.tsx          # password, linked Google, active sessions
│
├── (auth)/                            # minimal layout
│   ├── login/ · register/ · forgot-password/ · reset-password/ · verify-email/
│
├── (checkout)/                        # distraction-free layout
│   ├── checkout/page.tsx              # address → delivery check → payment mode → pay
│   └── checkout/success/[orderNumber]/page.tsx
│
├── admin/                             # staff only; 2FA enforced in layout + services
│   ├── layout.tsx · page.tsx          # sidebar shell · dashboard
│   ├── products/ (list · new · [id] tabs: details, media, variants, inventory, SEO)
│   ├── categories/ · attributes/      # attributes = colours, sizes, fits, size charts
│   ├── collections/ (list · new · [id]: manual products, rules, ordering, SEO)
│   ├── inventory/ (levels · movements · low-stock)
│   ├── discounts/ (automatic + coupons)
│   ├── orders/ (list · [id]: payments, shipments, history, cancel/refund)
│   ├── exchanges/ · shipments/ · customers/ (list · [id]) · reviews/
│   ├── marketing/                     # back-in-stock, abandoned carts, newsletter subscribers
│   ├── reports/                       # sales, GST tax export, COD remittance
│   ├── settings/                      # store, shipping fees, partial COD, tax rules, notifications
│   ├── staff/ · audit-logs/ · system/ # system = jobs, dead letters, webhook events
│   └── cms/                           # content roles allowed here
│       ├── layout.tsx · page.tsx      # overview: drafts, in review, scheduled, broken refs
│       ├── pages/ (list · [id] block editor · [id]/revisions)   # includes the homepage
│       ├── blog/ (posts · categories · tags · authors)
│       ├── media/ · navigation/ · redirects/ · settings/       # settings = brand, social, SEO defaults, announcement
│
└── api/
    ├── auth/[...all]/route.ts         # Better Auth handler
    ├── webhooks/razorpay/route.ts
    ├── webhooks/logistics/route.ts    # Shiprocket (neutral path name)
    ├── internal/revalidate/route.ts   # internal network + HMAC only; blocked at Caddy
    ├── health/route.ts · health/ready/route.ts
    ├── preview/route.ts · preview/exit/route.ts   # draftMode with signed token
    ├── media/upload/route.ts          # streaming multipart upload (staff)
    ├── serviceability/route.ts        # PIN code check (rate limited, cached)
    ├── search/suggest/route.ts        # autocomplete
    └── exports/[id]/route.ts          # permission-checked private file download
```

**As built in Phase 2 (ADR-020):**
- Route groups `(storefront)` and `(auth)` exist; `src/app/auth/complete/route.ts` finishes every sign-in (merges the guest bag) and `api/test/otp` serves end-to-end tests only.
- Widgets that combine several features sit next to their route (`products/[slug]/_components/`), and shared storefront UI is in `src/components/` (`brand/`, `layout/`, `product/`, `rich-text.tsx`, `newsletter-form.tsx`).
- New modules: `cart`, `wishlist`, `customers`, `marketing` (newsletter), `shipping` (serviceability provider); `auth/` holds the sign-in forms and session guards. Listings and search stay in `catalog/storefront.ts` until a search engine is added.

Mutations use **Server Actions** in `features/*/actions.ts` by default. Route handlers are used only for webhooks, file streaming, auth, health checks, internal calls and cacheable GET endpoints.

## 4. `src/features/`: domain modules

```
src/features/
├── auth/            # login flows, OTP, Google, staff 2FA enforcement helpers
├── customers/       # profiles, addresses, consent, account deletion/export
├── staff/           # staff users, role assignment
├── catalog/         # departments, categories, attributes, products, variants, size charts
├── media/           # upload pipeline, media library, references, safe deletion
├── inventory/       # levels, reservations, movements, low-stock
├── collections/     # manual + rule-based membership, ordering
├── search/          # FTS queries, facets, suggestions (SearchProvider)
├── cart/            # cart, merge on login, validation
├── wishlist/
├── pricing/         # quote engine (pure), tax calculation
├── discounts/       # automatic discounts, coupons, redemptions
├── checkout/        # place order, payment plan, eligibility (COD rules)
├── orders/          # order lifecycle, cancellation, history
├── payments/        # Razorpay orders/verification/webhooks/refunds/reconciliation
├── wallet/          # ledger, credits/debits
├── shipping/        # shipments, tracking, serviceability cache, COD remittance
├── exchanges/       # exchange requests lifecycle
├── reviews/         # submission, moderation, rating stats
├── notifications/   # templates registry, channel routing, logs
├── marketing/       # back-in-stock, abandoned cart, newsletter
├── analytics/       # consent-aware GA4/Meta events, CAPI payloads
├── contact/         # contact form and the admin Messages inbox
├── cms/             # pages, blocks registry, revisions, workflow, nav, site settings, redirects, blog
├── settings/        # store settings (commerce config)
├── reports/         # dashboard metrics, exports (GST, sales, COD)
└── audit/           # audit log writer + viewer queries
```

**Standard layout of one module** (shown for `orders`; modules leave out files they don't need):

```
src/features/orders/
├── index.ts              # PUBLIC surface: the only file other modules may import
├── service.ts            # business rules, transactions, permission checks ('server-only')
├── repository.ts         # Drizzle queries; no business rules ('server-only')
├── queries.ts            # cached reads for RSC ("use cache" + cacheTag) ('server-only')
├── actions.ts            # 'use server' — authenticate → authorize → Zod parse → service
├── schemas.ts            # Zod input/output schemas (safe for client import)
├── state-machine.ts      # allowed transitions + history writing
├── errors.ts  types.ts  constants.ts
├── ui/                   # domain components (storefront/ and admin/ subfolders if both)
└── *.test.ts             # colocated unit tests
```

The CMS module also has `blocks/`, with one folder per block type, each holding:

- `schema.ts`: Zod schema plus a JSON-safe default value
- `editor.tsx`: the admin form
- `render.tsx`: the storefront server component
- `refs.ts`: extracts references to products, collections, categories and media

Blocks are registered in `blocks/registry.ts`. Initial block types: `hero_banner`, `promo_slider`, `announcement`, `category_showcase`, `featured_collections`, `product_rail` (new arrivals, best sellers, trending, manual list), `promo_banner_grid`, `rich_text`, `brand_story`, `newsletter`, `faq_list`, `image_with_text`.

## 5. `src/server/`, `src/db/`, `src/worker/`

```
src/server/                                  (✓ = built in Phase 1)
├── operation.ts                            # ✓ defineOperation(): authorize → validate → handle; registry
├── errors.ts · http.ts                     # ✓ DomainError + codes; route-handler error responses
├── audit.ts                                # ✓ writeAudit() inside the business transaction
├── health.ts                               # ✓ readiness checks used by /api/health/ready
├── db/client.ts · transaction.ts · sql.ts  # ✓ pool, drizzle, withTransaction(), array params
├── auth/
│   ├── options.ts                          # ✓ Better Auth options (pure; shared with the CLI)
│   ├── auth.ts · cli-config.ts             # ✓ lazy getAuth(); entry for `npm run auth:generate`
│   ├── roles.ts · permissions.ts           # ✓ 7 roles; access-control statements
│   └── actor.ts · session.ts               # ✓ Actor type; actorFromHeaders()/getActor()
├── jobs/boss.ts · queues.ts · enqueue.ts   # ✓ pg-boss roles, queue policies, transactional enqueue
├── cache/tags.ts · revalidate.ts           # ✓ tag builders, fan-out to every replica
├── notifications/
│   ├── templates.ts · email.ts · sms.ts    # ✓ web-safe: props/subjects, queueEmail, OTP SMS
│   └── render.tsx · delivery.ts            # ✓ worker-only: react-dom/server rendering, SMTP send
├── storage/local.ts                        # ✓ media StorageAdapter (local volume)
├── security/hmac.ts                        # ✓ signed internal requests
├── observability/logger.ts                 # ✓ pino
└── integrations/                           # Phase 3+: razorpay/, shiprocket/, whatsapp/, meta-capi/, turnstile/

src/emails/          # ✓ email templates as React components (inline styles)
src/cli/             # ✓ create-super-admin.ts (bundled to dist/)

src/db/
├── schema/          # one file per domain: auth.ts, customers.ts, catalog.ts, inventory.ts,
│   │                # collections.ts, cart.ts, orders.ts, payments.ts, wallet.ts, shipping.ts,
│   │                # exchanges.ts, discounts.ts, reviews.ts, marketing.ts, cms.ts, media.ts,
│   │                # settings.ts, ops.ts (audit, webhooks, idempotency, notifications)
│   └── index.ts     # re-exports all tables + relations
├── migrations/      # drizzle-kit generated SQL + snapshots (committed, reviewed in PRs)
├── migrate.ts       # programmatic migrator used by the `migrate` container
└── seed/            # ✓ deterministic demo data (data.ts, images.ts SVG silhouettes, content.ts CMS)

src/worker/
├── index.ts         # ✓ start pg-boss, ensure queues, heartbeat, graceful shutdown
└── handlers.ts      # ✓ queue → handler map and schedules (handlers call services only)
```

## 6. `tests/`

```
tests/
├── integration/     # Vitest against real Postgres (Docker): concurrency, webhooks, RBAC matrix
├── e2e/             # Playwright: customer, admin, CMS journeys + axe accessibility checks
├── load/            # k6 scripts: browse, search, checkout initiation burst
├── fixtures/        # Razorpay/Shiprocket payload samples, factories
└── helpers/         # db reset, actor factories, fake providers wiring
```

Unit tests sit next to the code they test (`*.test.ts`).

## 7. Boundary rules (enforced with ESLint)

1. `app/**` may import from `features/*/index.ts`, `features/*/actions.ts`, `features/*/queries.ts`, `features/*/ui/**`, `components/**`, `lib/**`, `hooks/**` and `config/**`. It may **not** import `repository.ts` or `server/db`.
2. `features/A/**` may import `features/B/index.ts` only, never B's internals.
3. Database access stays inside `features/**` (services, and `repository.ts`/`derived.ts` for shared or complex SQL), `server/**`, migrations and the seed. Routes, components and `lib` never touch it (ADR-0019).
4. Files with `'server-only'` are never imported by client components. The worker and migrate bundles (and Vitest) alias `server-only` to `scripts/stubs/server-only.mjs`, because they run as plain Node.
5. `lib/**` has no framework or database imports, so it is fully unit-testable.
6. `components/ui/**` is shadcn output. We edit it deliberately, and never add business logic to it.

## 8. Naming

- Files and folders use kebab-case. React components use PascalCase exports.
- Database tables and columns use `snake_case`. TypeScript uses `camelCase` (via Drizzle's `casing: 'snake_case'`).
- Server Actions are verbs: `createProduct`, `approveExchange`. Queries are nouns: `getProductBySlug`, `listOrders`.
- Money fields end in `Paise` / `_paise`. Timestamps end in `At` / `_at`.
- Environment variables are prefixed by domain: `DATABASE_URL`, `AUTH_*`, `RAZORPAY_*`, `SHIPROCKET_*`, `SMTP_*`, `WHATSAPP_*`, `SMS_*`, `STORAGE_*`, `META_*`, `GA4_*`, `SENTRY_*`, `TURNSTILE_*`, `INTERNAL_*`.

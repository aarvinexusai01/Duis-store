# 06 — Implementation Phases

## Overview

The phases follow technical dependencies while putting the storefront first. Each phase ends with a **working vertical slice** that has been verified, never a disconnected mock. Docker packaging starts in Phase 0 and is tested in CI throughout. Phase 7 hardens it for production rather than introducing it.

| Phase | Name | Size | Milestone at exit |
|---|---|---|---|
| 0 | Project setup & engineering foundation | S | Empty app builds, lints, tests and runs in Docker. CI is green. |
| 1 | Backend foundation | L | Schema, auth, roles, catalogue, inventory, collections, media, jobs and demo seed all work. |
| 2 | Storefront: browse & account | L | **M1:** a customer can browse the demo catalogue, filter, search, see variant-accurate PDPs, use the wishlist and cart, sign in and manage addresses. |
| 3 | Checkout, payments & orders | XL | **M2:** a test-mode order is paid prepaid or partial COD (with coupon and wallet). Overselling is impossible. |
| 4 | Admin portal & operations | XL | **M3:** staff manage the catalogue, stock, discounts and orders, and fulfil through Shiprocket (fake or real). |
| 5 | Post-purchase & engagement | L | Exchanges, tracking, WhatsApp, reviews, back-in-stock alerts, abandoned-cart emails and consent-aware analytics |
| 6 | CMS portal | L | **M4:** editors build, preview, review, schedule and publish the homepage and pages, and the storefront updates live. |
| 7 | Production deployment & operations | M | **M5:** stack running on the VPS behind Cloudflare, with backups, monitoring and rollback |
| 8 | Hardening, verification & launch | M | All Definition-of-Done scenarios pass. Live credentials are activated. Go-live. |

Sizes are relative (S < M < L < XL), not calendar estimates.

**Start in parallel from day one.** These have external lead times:
- SMS DLT registration (entity, header and OTP template), which can take days to weeks
- WhatsApp Business account verification and template approval
- Razorpay KYC for live mode
- Shiprocket account and pickup address
- Domain purchase and Cloudflare onboarding
- Choosing the VPS and email provider

See [10-open-questions.md](10-open-questions.md).

---

## Phase 0: Project setup & engineering foundation

**Goal:** a reproducible, checked skeleton that every later phase builds on.

Tasks:
1. **Before Phase 0, confirm the tooling.** Start Docker Desktop (it is installed but wasn't running on 2026-10-13), then run `node -v` (24.x) and `npm -v` (11.x).
2. **Scaffold with the official CLIs. Run each with `--help` first, because the CLIs change.**
   - `npx create-next-app@latest <name> --ts --tailwind --eslint --app --src-dir --turbopack --import-alias "@/*" --use-npm` (or the current equivalent flags). **⚠ Verify:** `create-next-app` refuses non-empty folders that contain unrecognised entries, and the existing `doc/` folder may count as one. If so, scaffold into a scratch folder and move the generated files into `Duis-store/` (keeping `.git` and `doc/` untouched).
   - `npx shadcn@latest init`, using the Radix base. Then add the baseline components: button, input, form, dialog, sheet, dropdown-menu, select, tabs, table, badge, toast/sonner, skeleton, command, popover, calendar.
3. **Install dependencies** with `npm install` only, then commit `package-lock.json`:
   - drizzle-orm, drizzle-kit, pg, zod
   - better-auth
   - pg-boss
   - pino
   - @sentry/nextjs
   - react-hook-form, @hookform/resolvers
   - @tanstack/react-table
   - sharp
   - Dev: vitest, @playwright/test, @axe-core/playwright, tsup
4. **Configuration:**
   - `next.config.ts`: `output: 'standalone'`, `cacheComponents: true`, custom image loader, `poweredByHeader: false`
   - `tsconfig` strict mode with `noUncheckedIndexedAccess`
   - ESLint flat config with the import-boundary rules from 04 §7
   - Prettier
   - `.nvmrc` set to 24
   - `.editorconfig`
5. **Environment variables:** `src/config/env.ts`, a Zod-validated loader, plus `.env.example` containing placeholders only.
6. **Local stack:** `compose.dev.yaml` with Postgres 18 (volume at `/var/lib/postgresql`, port on localhost only) and Mailpit.
7. **Docker skeleton:** a multi-stage `Dockerfile` (deps → build → runtime, non-root, standalone output, worker bundle) and a `.dockerignore`. `docker build` must succeed.
8. **CI:** `.github/workflows/ci.yml` runs `npm ci`, lint, typecheck, unit tests, integration tests (Postgres service container), `next build` and `docker build`.
9. **Decisions to settle:**
   - Whether to use Drizzle 1.0 if it has become stable
   - Whether TypeScript 7 works with Next's type-check step
   - pg-boss transactional enqueue (custom database executor or an outbox table)

   Each outcome is recorded as an ADR.
10. **Repository hygiene:** README skeleton, PR template, Dependabot, branch protection on `main` (requires CI to pass), conventional commits.

**Exit criteria:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `docker build .` all pass locally and in CI. `docker compose -f compose.dev.yaml up` starts Postgres and Mailpit, and the app connects to them.

---

## Phase 1: Backend foundation

**Goal:** the core domain model and the infrastructure every feature depends on.

Tasks:
1. **Database foundations:**
   - DB client with a pool, `withTransaction()`, and the role split (`duis_owner` runs migrations, `duis_app` is used at runtime)
   - Extensions init script
   - First migrations
2. **Auth (Better Auth):**
   - Email and password, with verification and reset emails sent to Mailpit
   - Phone OTP through the `fake` SMS provider in development
   - Google OAuth
   - Database sessions and rate limiting stored in the database
   - The `admin` plugin and access control with five roles (super_admin, store_admin, content_manager, content_editor, customer) and a permission matrix
   - TOTP two-factor that staff must use
   - `requirePermission()` helpers and an `ActorContext`
   - `npm run admin:create`, a CLI that bootstraps the first super admin
3. **Catalogue:**
   - Schema: departments, ltree categories, attributes and values, size charts, products, `product_categories`, variants with `option_signature`, `product_media`
   - Services for create, update, publish and archive
   - `product_listing_cache` maintenance
4. **Inventory:**
   - Locations (one default), levels, reservations, movements
   - Reserve, commit, release, restock and adjust as single-statement operations
   - The concurrency integration test (N parallel reservations for the last unit)
5. **Collections:** manual and rule-based membership, plus the refresh job.
6. **Media:**
   - The `StorageAdapter` (`local`)
   - The upload pipeline: magic bytes → sharp re-encode → renditions → content-hashed key
   - The `media_assets` table and the custom `next/image` loader
7. **Jobs:** pg-boss bootstrap, `src/worker/index.ts`, queue registry, retry and dead-letter policies, graceful shutdown, and the tsup bundle.
8. **CMS read side,** defined early so the storefront is CMS-driven from the start:
   - `cms_pages`, `cms_revisions` and `cms_revision_refs` schema
   - The block registry with Zod schemas and server renderers for the homepage blocks
   - `getPublishedPage(slug)` with cache tags
9. **Cross-cutting:**
   - Logger with request IDs
   - `DomainError`
   - Audit log writer
   - Idempotency helper
   - Cache-tag builders and the `/api/internal/revalidate` endpoint, protected by HMAC
10. **Demo seed:**
    - Deterministic data: about 60 products across all categories, colours × sizes, realistic stock, about 8 collections, a seeded homepage revision, and staff users for each role
    - Placeholder images generated (with sharp) as on-brand colour blocks with typography, never proprietary imagery

**Exit criteria:**
- Migrations apply cleanly to an empty database and the seed runs.
- RBAC matrix tests pass (every protected service function × every role).
- The parallel-reservation test proves no overselling.
- An uploaded image is sanitised and served with renditions.
- A queued job runs in the worker container and retries on failure.

---

## Phase 2: Storefront (browse & account)

**Goal:** the premium, bold-streetwear shopping experience on real data. This is the highest-priority surface.

Tasks:
1. **Design system:**
   - Tokens (colour, type scale, spacing, radii) in `globals.css`
   - Display and body fonts via `next/font`
   - Streetwear look: high contrast, chunky headings, graphic badges
   - Accessible focus states. Mobile-first breakpoints.
2. **Layout:**
   - Announcement bar
   - Header with mega menu (from the seeded navigation revision), search, wishlist, account and cart icons
   - Mobile drawer navigation
   - Footer (links, social, newsletter)
   - Cart drawer
3. **Homepage** rendered from the published CMS revision: hero, promo slider, shop by category, featured collections, product rails (new arrivals, best sellers, trending, featured), seasonal promotion, brand story, newsletter.
4. **Listings:**
   - `/shop/[[...slug]]` and `/collections/[slug]`
   - Filters: category, subcategory, collection, colour (by `filter_group`), size, price range, availability
   - Sorting and pagination, all reflected in the URL (shareable, SEO-safe)
   - Facet counts
   - `noindex` on filtered combinations
   - Cards: image hover swap, price, MRP, % off, available colours, wishlist toggle
5. **Search:** `/search` (full-text search with trigram fallback), plus an autocomplete endpoint with debounce and keyboard navigation.
6. **Product page:**
   - Gallery that follows the selected colour (zoom on desktop, swipe on mobile)
   - Colour and size selectors that disable unavailable combinations
   - Price, MRP and stock for the exact variant (stock streamed fresh, never cached)
   - Size guide modal
   - Specifications and legal details (country of origin, manufacturer, net quantity, MRP inclusive of taxes)
   - PIN-code delivery check (fake provider for now)
   - Shipping and exchange info, related products
   - JSON-LD `Product`/`Offer` structured data
   - Add to Cart, Buy Now, Wishlist
7. **Cart:**
   - Anonymous cart via a signed cookie
   - Add, update and remove
   - Merge into the account at login
   - Server validation (inactive variant, insufficient stock, maximum quantity per line)
   - Order summary with estimated savings
8. **Auth pages:** login (phone OTP first, with email and Google), register, forgot and reset password, verify email. Turnstile hooks (a no-op in development).
9. **Account:** overview, profile (with consent toggles), addresses (CRUD with PIN-code → city and state helper), security (password, sessions), and wishlist.
10. **SEO basics:**
    - `generateMetadata` for every route
    - Canonical URLs
    - `sitemap.ts` (products, categories, collections, pages, blog)
    - `robots.ts`
    - Open Graph images
    - Breadcrumb JSON-LD

**Exit criteria:**
- Playwright passes for browse → filter → PDP variant switch (price and stock correct) → add to cart → login with OTP (fake) → cart merged.
- axe finds no serious violations on key pages.
- Lighthouse mobile performance is ≥ 90 on home, listing and PDP with the seeded data.

---

## Phase 3: Checkout, payments & orders

**Goal:** money and stock correctness, end to end, in Razorpay **test mode**.

Tasks:
1. **Pricing engine** (pure, heavily unit-tested): automatic discounts, coupon validation, pro-rata allocation, shipping fee rule, COD fee, GST lines from `tax_rules`, wallet, payment plan, `quoteHash`.
2. **Discount services:** eligibility, usage limits enforced under row locks, redemption and reversal.
3. **Checkout page:**
   - Address selection or entry
   - Serviceability and COD eligibility
   - Payment mode (Prepaid or Partial COD, showing advance and balance)
   - Wallet toggle and coupon field
   - Final summary with every charge shown before payment
4. **Place order:** the single transaction from 03 §3 (order, items, tax lines, reservations, wallet debit, coupon redemption), using the idempotency key.
5. **Razorpay:**
   - Create the order with `PaymentGateway`
   - Checkout.js integration
   - Callback verification (signature plus server-side fetch)
   - Webhook endpoint with raw-body HMAC, `webhook_events` deduplication and the processing job
   - `confirmOrder()` idempotent
   - The `payments.reconcile` job
6. **Lifecycle jobs:**
   - Reservation expiry (with a reconcile check first)
   - Late-payment handling
   - Customer cancellation before dispatch (Razorpay refund plus wallet reversal)
7. **Wallet:** ledger service and the account wallet page.
8. **Post-confirmation:**
   - Order confirmation email (React Email)
   - Success page
   - Account order list and detail with the status timeline
9. **Emails:** a template set (order placed, payment failed, order cancelled, refund issued) sent through Mailpit in development.

**Exit criteria (integration and end-to-end):**
- The last-unit race: two customers check out at once, and exactly one succeeds.
- Duplicate and out-of-order webhooks are no-ops.
- Failed payment → retry → success.
- Expiry releases stock, wallet and coupon.
- The coupon usage limit holds under concurrency.
- A partial-COD order records the correct advance and COD due.
- Tampered client totals are ignored.
- A test-mode Razorpay payment succeeds manually with real test keys.

---

## Phase 4: Admin portal & operations

**Goal:** the business can run day-to-day operations from `/admin`.

Tasks:
1. **Shell:** sidebar, breadcrumbs, command palette search, a shared `DataTable` (server pagination, filters, column visibility, bulk actions, CSV export), status badges, confirmation dialogs. Every page and action has permission checks.
2. **Dashboard:** revenue, orders and AOV over time, fulfilment backlog, recent transactions, low-stock list, best sellers, pending exchanges, COD balance pending.
3. **Products:**
   - List with filters
   - Create and edit: details, Tiptap description, specifications, legal fields, HSN, categories
   - Media manager: drag to reorder, assign images to a colour
   - **Bulk variant generator** (pick colours × sizes → grid editor for SKU pattern, price, MRP, stock, status, with bulk-fill)
   - Publish, archive, duplicate
   - SEO tab
4. **Categories** (tree editor with drag-and-drop reordering), attributes and values (swatches, filter groups), size charts.
5. **Collections:** manual product picker with ordering, rule builder with live preview count, banners and images, publish and archive, SEO.
6. **Inventory:**
   - Searchable stock table per SKU
   - Receive, adjust and count-correct with a reason
   - Movement history
   - Low-stock thresholds and alerts (dashboard plus a daily email)
7. **Discounts:** automatic discounts and coupons (bulk code generation), scheduling, limits, eligibility, stacking flags, usage report.
8. **Orders:**
   - List (filters by status, payment mode, date)
   - Detail: items, tax lines, payments, refunds, history, shipments
   - Cancel or refund (with permission, reason and audit)
   - Notes
9. **Shipping (Shiprocket provider):**
   - API client with a token store
   - Create shipment → AWB → label → pickup
   - Bulk "ready to ship"
   - Label download
   - Tracking webhook and sync job
   - COD remittance reconciliation, with CSV import as a fallback
   - Shipment cancellation
10. **Customers:** list and detail (orders, addresses, wallet ledger, reviews, COD block toggle), plus goodwill wallet credit (with permission and reason).
11. **Staff and administration:**
    - Invite staff, assign roles, enforce 2FA, revoke sessions
    - Audit log viewer
    - System page: job queues, dead letters (retry or discard), webhook events
12. **Settings:**
    - Store and legal details
    - Shipping fee rules
    - Partial-COD rules
    - Exchange policy values
    - Tax rules (HSN slabs)
    - Notification templates and their mapping
    - Integration health (which providers are configured, plus a test-connection button)
13. **Reports:** sales by day and category, a **GST export** CSV (per line: invoice-ready fields, HSN, taxable value, CGST/SGST/IGST, place of supply) for the external tool, and a COD remittance report.

**Exit criteria:**
- The Administrator Definition-of-Done scenario passes against the fake Shiprocket provider.
- One real Shiprocket test shipment is created and cancelled, once the account is available.
- Every admin mutation appears in the audit log.
- A Content Editor is denied on all commerce actions, both in the UI and on direct calls to the actions.

---

## Phase 5: Post-purchase & engagement

Tasks:
1. **Exchanges:**
   - Customer request flow (eligibility, replacement variant with live stock, reason, photos)
   - Admin approve or reject
   - Reverse pickup through the provider
   - QC and receive (restock)
   - Replacement shipment
   - Price-difference payment or wallet credit
   - Notifications at each step
2. **Tracking UI:** order timeline from normalised events, and tokenised tracking links in messages.
3. **WhatsApp channel:** BSP adapter plus template registry (order confirmed, shipped, out for delivery, delivered, exchange updates). Quiet hours and opt-out handling. Email fallback.
4. **SMS OTP:** real provider adapter (DLT template ID wiring) and abuse controls: per-phone and per-IP limits, Turnstile, cooldowns.
5. **Reviews:**
   - Prompt after delivery
   - Verified-buyer submission with photos and fit feedback
   - Moderation queue
   - Rating stats job
   - Ratings on cards and PDP, and `AggregateRating` JSON-LD (approved reviews only)
6. **Back-in-stock:** subscribe on a sold-out variant. The 0 → > 0 stock trigger queues notifications, sent in batches, with unsubscribe.
7. **Abandoned cart:** signed-in carts idle for 1 hour or more get up to 2 reminders. Requires marketing consent. Skipped if the customer has ordered since. Includes a deep link to restore the cart.
8. **Analytics and consent:**
   - Consent banner (necessary, analytics, marketing) with records in `consent_records`
   - GA4 with Consent Mode and e-commerce events
   - Meta Pixel plus Conversions API with a shared `event_id` for deduplication
   - Hashed identifiers only, and only after consent
9. **Newsletter** (double opt-in) and a **contact form** that stores messages and emails the team.

**Exit criteria:**
- An exchange runs end to end (fake provider) with correct stock movements and a correct wallet or payment for the difference.
- No analytics or Pixel requests fire before consent (checked with a Playwright network assertion).
- The OTP abuse limits are tested.

---

## Phase 6: CMS portal

Tasks:
1. **Page builder** (`/admin/cms/pages/[id]`):
   - Section list with dnd-kit reordering
   - Add, duplicate, disable and delete sections
   - Per-block forms from the registry, with a media picker and product, collection and category pickers
   - Inline validation
   - Autosaved drafts
2. **Revisions and workflow:**
   - Revision history with diff summary
   - Submit for review, approve, request changes, publish, schedule (date and time in IST), unpublish, archive
   - Rollback (copy a revision into a new draft)
   - Every transition audited, and role-gated: editors can't publish
3. **Preview:** a signed draft-mode link that renders the exact revision with real storefront components. Desktop and mobile preview toggle.
4. **Scheduling:** the `cms.publish-scheduled` job, followed by revalidation fan-out. An overview of scheduled items.
5. **Media library:** grid and list, search, filters, upload with progress, alt text and focal point editing, usage list ("where used"), and safe delete (blocked while referenced).
6. **Navigation:** header mega-menu editor (columns, links to categories, collections or pages, promo tiles, badges), plus footer and social menus, all with draft/publish.
7. **Blog:** posts (Tiptap with images, embeds allow-listed), categories, tags, authors, featured image, SEO, scheduling, RSS feed.
8. **Pages and SEO:** landing, static and policy pages; FAQ block; per-page SEO (title, description, canonical, OG image, noindex); redirects manager (automatic redirect when a slug changes).
9. **Site settings:** brand name, logo, favicon, announcement bar, social links, contact and grievance officer details, default SEO, all with draft/publish.

**Exit criteria:**
- The CMS Definition-of-Done scenario passes in Playwright: a change is published and the live page updates within 10 seconds, with no rebuild, on **both** replicas.
- A scheduled publish fires on time from the worker.
- Deleting a media item or collection that is in use is blocked with a clear message.

---

## Phase 7: Production deployment & operations

Tasks:
1. **Production `compose.yaml`:**
   - Services: `caddy`, `web_a`, `web_b`, `worker`, `postgres` (custom image with pgBackRest), `backup`, and `migrate` (tools profile)
   - Networks `edge` and `backend` (internal)
   - Volumes, health checks, restart policies, resource limits, log rotation, read-only root filesystems, `no-new-privileges`
2. **Caddyfile:**
   - Origin CA TLS
   - Real IP from Cloudflare ranges only
   - Security headers (HSTS, CSP from the app, frame-ancestors, referrer policy, permissions policy)
   - Body limits (1 MB default, 15 MB for `/api/media/upload`)
   - `/media/*` static with immutable caching
   - Load balancing with active health checks and `lb_try_duration`
   - Block `/api/internal/*`
3. **Server bootstrap script:**
   - Ubuntu updates and unattended upgrades
   - Deploy user, SSH keys only, root login disabled
   - Docker Engine and Compose plugin
   - ufw firewall: port 443 from Cloudflare ranges, SSH from allowed IPs
   - Docker daemon log rotation, time sync, swap
4. **Scripts:**
   - `deploy.sh` and `rollback.sh` (see 07 §4)
   - `backup-now.sh`, `restore.sh`, `restore-drill.sh`
   - `update-cloudflare-ips.sh`
   - `smoke-test.sh`
5. **Backups:** pgBackRest (full weekly, differential daily, continuous WAL archive to S3, encrypted), a nightly `pg_dump` to restic, a restic media snapshot, retention and pruning, and a weekly `restic check`.
6. **Monitoring:**
   - Sentry DSN for web and worker
   - External uptime check on `/api/health`
   - Alert emails for job dead letters, failed backups, disk over 80 %, and certificate or DNS problems
7. **Runbooks** in `doc/runbooks/`: deploy, rollback, restore, incident first steps, secret rotation, adding a replica, moving media to S3.

**Exit criteria:**
- A fresh VPS is bootstrapped from the scripts.
- The site is served over HTTPS through Cloudflare, and the origin is unreachable directly.
- A deploy causes no failed requests (checked with a load generator running during the deploy).
- Rollback switches to the previous SHA in under 2 minutes.
- **A restore drill to a scratch server succeeds**, with measured RPO and RTO.

---

## Phase 8: Hardening, verification & launch

Tasks:
1. **Security review** against the [08 checklist](08-security-compliance.md): authorization on every action, headers and CSP, upload fuzzing, webhook replay, rate limits, secret scan, `npm audit`, container image scan, Postgres not exposed.
2. **Load test (k6):** browsing at an expected peak of 5–10× the average, search, and a checkout-initiation burst on the same SKUs. Tune Postgres, the connection pool and replica settings. Revisit ADR-008 if needed.
3. **Quality audits:** Lighthouse budgets, axe on every template, keyboard-only checkout run, structured-data validation, sitemap and robots checks, broken-link scan.
4. **Definition of Done:** all four acceptance scenarios on the production-like stack, plus a container restart with data persisting.
5. **Go-live activation:**
   - Razorpay live keys and live webhook
   - Shiprocket live pickup
   - SMS DLT and WhatsApp templates live
   - Email domain authentication (SPF, DKIM, DMARC)
   - Google OAuth production client
   - GA4 and Meta IDs
   - Real catalogue entry, and removal of the demo seed
6. **Launch checklist and hypercare:**
   - First-week daily checks: payments reconciliation, stuck orders, dead letters, error rate, backup status

**Exit criteria:** every checklist item is signed off, and launch is approved by you.

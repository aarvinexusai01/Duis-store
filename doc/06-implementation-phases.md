# 06 — Implementation Phases

## Overview

The phases follow technical dependencies while putting the storefront first. Each phase ends with a **working vertical slice** that has been verified, never a disconnected mock. Docker packaging starts in Phase 0 and is tested in CI throughout. Phase 7 hardens it for production rather than introducing it.

| Phase | Name | Size | Milestone at exit |
|---|---|---|---|
| 0 | Project setup & engineering foundation | S | ✅ **Done 2026-10-13.** Empty app builds, lints, tests and runs in Docker. CI is ready to run on the first push. |
| 1 | Backend foundation | L | ✅ **Done 2026-10-15.** Schema, auth, roles, catalogue, inventory, collections, media, jobs and demo seed all work. |
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

> **Status: complete (2026-10-13).** Verified locally:
> - Lint (including the boundary-rule probes), typecheck and format check pass.
> - 11 unit tests, 8 integration tests (roles, extensions, transactional job queueing, SMTP to Mailpit) and 6 Playwright tests (2 viewports, axe, health checks, headers) pass.
> - `next build`, the esbuild server bundles and `docker build` (no secrets in context) succeed.
> - The hardened container became healthy as non-root on a read-only filesystem, and its readiness check reached Postgres.
> - The migrate and worker roles ran from the same image, with a scheduled job processed and graceful SIGTERM shutdown.
>
> Decisions recorded in ADR-014 to ADR-017. **Still open (need GitHub access):**
> - The first CI run on GitHub, after the first push.
> - Branch protection on `main` (Settings → Branches: require the four CI jobs).

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

> **Status: complete (2026-10-15).** Every exit criterion was verified:
> - **Migrations apply to an empty database:** each integration run builds a fresh `duis_test` (35 tables, append-only history enforced by grants).
> - **The demo seed runs:** 65 products, 736 variants, 179 images, 9 collections, published CMS pages, menus and settings, one account per role.
> - **RBAC matrix:** 31 operations × 7 roles, plus anonymous and missing-2FA cases ([permissions](permissions.md)).
> - **No overselling:** 20 concurrent checkouts for the last unit produce exactly one reservation.
> - **Media:** uploads are re-encoded with metadata stripped, every width is written, and SVG, non-images, tiny images and oversized files are rejected. Images are served from the container.
> - **Jobs:** a failing job retries and completes. The worker container delivered queued emails through SMTP.
>
> Totals: 272 integration tests, 21 unit tests and 14 browser tests pass. The production build, the server bundles and the Docker image build. Decisions are in [ADR-0019](adr/0019-phase-1-implementation-decisions.md).
>
> **Moved to later phases:** CMS homepage renderers (Phase 2, with the design system), review and scheduling workflow (Phase 6), CSV import (later).

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
   - The `admin` plugin and access control with seven roles (super_admin, store_admin, content_manager, content_editor, fulfilment_staff, support_agent, customer) and a permission matrix
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

> **Status: complete (2026-10-15).** Every exit criterion was verified ([ADR-020](adr/0020-phase-2-storefront-decisions.md) records the decisions):
> - **Playwright:** browse → filter → product page variant switch (price and live stock checked against the database) → add to bag → phone-OTP sign-in (fake provider) → the bag is merged, on desktop and mobile. 22 end-to-end tests pass.
> - **axe:** no serious or critical violations on the home, listing and product pages.
> - **Lighthouse mobile (median of 3 runs, default simulated throttling, local production build):** home 91, listing 91, product page 92. CLS is 0 on all three.
> - **Integration:** 411 tests, including cart (guest token, stock and per-line limits, merge and adoption), wishlist, country-aware addresses, consent, newsletter double opt-in and serviceability. 58 unit tests.
>
> **Moved to later phases:**
> - Turnstile on the sign-in forms (Phase 7, Better Auth captcha plugin).
> - Adding or changing an email on a phone-only account (Phase 5).
> - Blog routes in the sitemap (with the blog, Phase 6).

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

> **Status: built and verified on 2026-10-15, except one manual check** ([ADR-021](adr/0021-phase-3-checkout-decisions.md)):
> - **Integration (16 checkout tests, 504 in total):**
>   - the last-unit race (4 buyers, 1 unit) and the coupon limit under concurrency;
>   - duplicate and out-of-order webhooks are no-ops;
>   - failed payment → retry → success;
>   - expiry releases stock, wallet and coupon;
>   - payment captured during expiry is confirmed; payment after the stock sold out is refunded;
>   - partial-COD advance and cash due;
>   - a stale or tampered quote is refused;
>   - cancellation refunds online money to source and wallet money to the wallet, once;
>   - promotional wallet credit expires and refunds don't;
>   - international orders are prepaid, zero-rated and limited to the approved countries.
> - **End-to-end (desktop and mobile):** sign in → bag → address → simulated payment → confirmed → cancel.
> - **Still to do (owner):** the manual payment with real Razorpay **test keys** (see the README, "Payments").
>
> **Moved:**
> - Live Shiprocket and Shiprocket X rates move to Phase 4 with the courier accounts. Fake rates are used until then, refused in production.
> - Staff screens for discounts, refunds and goodwill credit come with the admin portal (Phase 4).

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
10. **International checkout (ADR-018):**
    - Country-aware address form and validation
    - Prepaid only
    - Live international shipping rate
    - Duties and taxes terms (DDU/DDP) shown before payment
    - Blocked-country list
    - Razorpay international card payments in INR

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

> **Status: in progress, in three slices with a review stop after each** ([ADR-022](adr/0022-phase-4a-admin-decisions.md)).
> - **4a, built 2026-10-16:**
>   - Shell: sidebar filtered by permission, server tables, status badges.
>   - Staff 2FA enrolment.
>   - Dashboard.
>   - Products: details, Tiptap description, photos by colour, variant generator and grid, publish, archive, duplicate, SEO.
>   - Categories (up/down ordering), attributes, size charts.
>   - Collections: picker, rule builder with a live preview.
>   - Inventory: stock table, receive, adjust and count, movement history, thresholds.
> - **4b, built 2026-10-16** ([ADR-023](adr/0023-phase-4b-orders-shipping-decisions.md)):
>   - **Orders:** list with views (to ship, in transit, COD to collect, returns), detail with tax lines, payments, refunds, wallet, parcels, notes and history.
>   - **Order actions:** start packing, book a parcel (single or bulk), label download, cancel parcel, staff cancel and refund, address correction.
>   - **Courier:** fake provider with demo scans; Shiprocket client (unverified).
>   - **Tracking:** webhook at `/api/webhooks/logistics`, plus a polling job.
>   - **Returns:** RTO restock.
>   - **COD:** remittance CSV import.
>   - **Customers:** COD block and goodwill credit.
>   - **Discounts:** edit, pause, archive, single-use bulk codes, usage report.
>   - **Still to do (owner):** the Shiprocket account and one real test shipment (doc/10 A5).
> - **4c, built 2026-10-16** ([ADR-024](adr/0024-phase-4c-administration-decisions.md)):
>   - **Settings:** store and legal, shipping, COD and RTO, policies, emails, tax rules, and integration health with test buttons.
>   - **Staff:** email invitations, roles, 2FA reset, deactivation, sign-out everywhere.
>   - **Audit log viewer.**
>   - **System page:** queues, failed jobs, webhooks, worker heartbeat.
>   - **Reports:** sales by day and category, COD, and the GST, sales and COD CSVs.
>   - **Moved from 4a:** CSV export of lists, column visibility, the command palette, and the daily low-stock email.
> - **Phase 4 status:** built. The exit criteria still waiting on the owner are one real Shiprocket test shipment (doc/10 A5) and the Razorpay test-mode payment (Phase 3).
> - **Moved from 4a to 4c, now built:** the command palette, column visibility, CSV export and the daily low-stock email.

**Slice 4b plan (orders, shipping, customers, discounts):**
1. **Schema (migration 0005):**
   - `shipments`, `shipment_items` and `shipment_tracking_events` (doc/05 §8);
   - `cod_remittances`;
   - `order_notes` (internal staff notes);
   - `provider_tokens` (the courier API token cache).
2. **Courier provider:**
   - The `ShippingProvider` interface gains: create order, assign AWB, label, pickup, cancel, tracking.
   - The **fake** provider issues deterministic AWBs and a generated label PDF. A development-only control moves a fake shipment through tracking.
   - The **Shiprocket / Shiprocket X client** has a token store, is selected with `SHIPPING_PROVIDER=shiprocket`, and is marked unverified until one real test shipment (doc/10 I1, A5).
3. **Shipments:**
   - The `shipments.create` job saves each step, so a retry resumes where it stopped.
   - Labels are copied to private storage.
   - The tracking webhook is `/api/webhooks/logistics`: token header, deduplication, a status mapping table, and statuses never move backwards. A `shipments.sync` polling fallback covers shipments with no update for six hours.
   - Order status follows the shipment: shipped → out for delivery → delivered, or RTO, which restocks when the parcel is received back.
   - Export shipments carry customs data.
4. **Orders admin:**
   - List with filters: status, payment mode, date, search.
   - Detail: items with tax lines, payments, refunds, wallet use, status history, shipments, notes.
   - Actions: start processing, create shipment (single and bulk "ready to ship"), download label, cancel shipment, cancel order (restock and refund), staff refund, add note, edit address before AWB.
5. **COD remittance:** CSV import, matched to orders, which marks the COD balance paid. Mismatches are listed for review.
6. **Customers admin:**
   - List and search.
   - Detail: orders, addresses, wallet ledger, COD block with a reason, goodwill credit.
7. **Discounts admin:**
   - Automatic discounts and coupons: create, edit, schedule, limits, eligibility, stacking.
   - Bulk code generation, deactivation, usage report.
8. **Tests:**
   - Integration:
     - shipment creation resumes after a failed step;
     - a duplicate or out-of-order tracking event is a no-op;
     - shipment cancellation;
     - remittance matching;
     - refund limits;
     - a Fulfilment user sees no amounts, and permissions are checked for every new operation.
   - End-to-end: the Administrator Definition of Done against the fake courier, i.e. order → ship → deliver → reconcile COD.

**Slice 4c plan (settings, staff, system, reports):**
1. **Settings** (`settings: read/update`, every change audited):
   - Store and legal: legal name, GSTIN, registered state, IEC, LUT reference.
   - Shipping: free-shipping threshold, international destinations.
   - Partial COD: on/off, advance (fixed or percent), order cap, COD fee, RTO advance policy.
   - Exchange values: window and limit, used in Phase 5.
   - Stock hold, and promotional credit validity.
   - Tax rules: HSN slabs, date-ranged; a change adds a new row and never rewrites past orders.
   - Notifications: as decided below.
   - Integration health: which providers are live or fake, with a "test connection" button for each.
2. **Staff** (`staff: manage` is Super Admin only):
   - Invite staff and assign roles.
   - See who has 2FA.
   - Reset a staff member's 2FA.
   - Revoke sessions and deactivate an account.
   - The last super admin can't be removed.
3. **Audit log viewer:** filter by person, action, record and date.
4. **System page** (`system: read/operate`):
   - Job queues with counts.
   - Dead letters: retry or discard.
   - Recent webhook events, with reprocess.
   - Worker heartbeat.
5. **Reports** (`report: read/export`):
   - Sales by day and by category.
   - The **generic GST CSV**, one row per line: date, order, HSN, taxable value, CGST/SGST/IGST, place of supply, export flag.
   - COD remittance report.
   - All CSV downloads are safe against spreadsheet formula injection.
6. **Items moved from 4a:** as decided below.
7. **Tests:**
   - Integration:
     - settings validation and audit;
     - tax rules never change past orders;
     - staff invitation and role change, and refusing to remove the last super admin;
     - dead-letter retry;
     - GST CSV totals equal order totals.
   - End-to-end: the Super Admin invites staff and reads the audit log; a Content Editor is refused everywhere.

**Owner decisions for 4c (2026-10-16):**
- **Staff join by email invitation:** a link valid for 72 hours. They set their own password, then set up 2FA.
- **Notification settings:** turn optional emails on or off (shipped, payment reminder, low-stock digest) and set the sender name and reply-to address. The wording of emails stays in code.
- **Daily low-stock email:** at 09:00 IST to Store and Super Admins, only when something is at or below its alert level.
- **Moved items, all built:** command palette (Ctrl/⌘+K), CSV export of lists, column visibility.

**Owner decisions for 4b (2026-10-16):**
- **One parcel per order:** no split shipments; the schema still allows them later.
- **Staff refunds** may be partial or full, up to the amount collected. Staff send the money to the original payment or the wallet. A reason is required, and the refund is audited.
- **Staff can cancel after an AWB, before pickup.** The courier cancellation must succeed first; only then is the order cancelled, restocked and refunded. Customers still can't cancel once an AWB exists.
- **COD remittances** come in by a generic CSV import. The Shiprocket remittance API is added after the account is verified.

**Assumptions for 4b** (low impact; tell me if any is wrong):
- **Invoices** stay with the external tool (decision 10). 4b numbers and prints none.
- **Address edits** are allowed only before an AWB, and only to a serviceable address in the same state. A different state would change the GST split, and that needs a cancel and a new order.
- **Pickup:** Shiprocket keeps the pickup address in its panel. The app needs only its nickname and PIN code, as `SHIPROCKET_PICKUP_LOCATION` and `SHIPROCKET_PICKUP_PINCODE` (changed while building 4b: environment values rather than a 4c setting).

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
   - **International shipping (ADR-018):** international courier provider, customs data (HS code, declared value, description, origin) on shipments, export documents, export lines flagged in the GST export
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

**Plan (written 2026-10-16, before building):**
- **Already decided in doc/10:**
  - Exchanges: 10-day window, innerwear excluded, 2 exchanges per item, free reverse pickup.
  - Price difference: the customer pays it through Razorpay, or it is credited to the wallet.
  - Reviews: every review is moderated.
  - Abandoned cart: email at 1 hour and 24 hours.
  - Back-in-stock: email, plus WhatsApp if the customer opted in.
  - International orders: exchanges only for damaged or wrong items, handled by admins.
- **Waiting on accounts** (doc/10 A2, A3, A11):
  - SMS DLT registration;
  - WhatsApp Business;
  - GA4 and Meta.
  
  As with Shiprocket, each gets a fake for development and tests and a real adapter that stays unverified until the account exists. Production refuses the fakes.
- **Owner decisions (2026-10-16):**
  - **Delivery:** three slices with a review stop after each:
    - 5a: exchanges, tracking page, reviews;
    - 5b: MSG91 WhatsApp and SMS OTP, OTP abuse limits, back-in-stock, abandoned cart;
    - 5c: consent banner, GA4, Meta Pixel and Conversions API, contact form.
  - **SMS and WhatsApp provider:** MSG91.
  - **Analytics:** GA4, Meta Pixel and the Conversions API. Each stays off until consent is given and its ID is set.
  - **An item that fails QC** is sent back to the customer at our cost. No replacement or credit is given, and the customer is emailed the reason.
- **5a, built 2026-10-16** ([ADR-025](adr/0025-phase-5a-exchanges-reviews-decisions.md)):
  - **Exchanges:**
    - Customers request from the order page, with photos.
    - Staff approve or reject, then mark received and pass or fail QC.
    - Free return pickups and replacements go through the courier pipeline.
    - The price difference is paid online, or credited to the wallet after QC.
    - Stock moves as `exchange_out` and `exchange_in`.
    - An email goes out at each step.
  - **Tracking page:** reached by a signed link, which the shipped email now uses.
  - **Reviews:**
    - Verified buyers submit, with photos and fit.
    - A moderation queue for staff.
    - Ratings on product cards and the product page, and `AggregateRating` in its structured data.
    - A review request 5 days after delivery.
- **5b plan and owner decisions (2026-10-16):**
  - **WhatsApp opt-in:** an unticked box at checkout ("Send order updates on WhatsApp"), plus an on/off switch in the account. Replying STOP turns it off.
  - **WhatsApp messages:**
    - order confirmed, shipped, out for delivery and delivered;
    - exchange steps;
    - back-in-stock alerts for people who asked.

    No promotions and no abandoned-cart messages on WhatsApp. Email is always sent as well.
  - **Quiet hours:** back-in-stock messages wait between 21:00 and 09:00 IST. Order and exchange updates go straight away.
  - **OTP abuse:**
    - Cloudflare Turnstile, switched on once its keys are set (doc/10 A10);
    - per phone: a 30-second resend cooldown, 5 an hour and 10 a day;
    - per IP: 20 an hour.
  - **MSG91 adapters** for SMS OTP (DLT template) and WhatsApp templates. They stay unverified until the account and approvals exist (A2, A3); the fakes are used until then.
  - **Back-in-stock:** "Notify me" on a sold-out size. When it's back in stock, a batched email (and WhatsApp if opted in) is sent, with a one-click unsubscribe.
  - **Abandoned cart:** signed-in bags idle for 1 hour and again at 24 hours; up to 2 reminders. Only for customers with marketing email consent, and skipped if they ordered since. The email links straight back to the bag and has a one-click unsubscribe.
- **5b, built 2026-10-16** ([ADR-026](adr/0026-phase-5b-messaging-alerts-decisions.md)):
  - **Login codes:** limits per phone and IP, and Turnstile once its keys are set.
  - **MSG91 adapters:** SMS OTP and WhatsApp (unverified).
  - **WhatsApp updates:** checkout opt-in and an account switch; order and exchange messages; back-in-stock alerts with quiet hours; STOP replies.
  - **Back-in-stock alerts:** "Notify me" on a sold-out size; one batched email per address.
  - **Bag reminders:** emails at 1 hour and 24 hours, with a signed unsubscribe.
- **5c plan and owner decisions (2026-10-16):**
  - **Contact form:** on `/contact`, below the page's content.
    - Each message is saved to a new **Admin → Messages** inbox (new, replied or closed; who handled it; an internal note).
    - It is also emailed to the support address set in Settings, with reply-to set to the customer, so staff answer from their mail client.
    - Spam protection: Turnstile once its keys are set, a hidden honeypot field and a per-IP limit.
  - **Consent banner:** "Accept all", "Reject all" and "Choose", equally visible.
    - "Choose" offers separate Analytics and Marketing switches.
    - Only essential cookies are set until the visitor answers.
    - It asks again after 12 months, or when the categories change.
    - "Cookie settings" in the footer reopens it.
    - Each answer is appended to `consent_records`: a random visitor ID, the account if signed in, the choices and the banner version. No IP address.
  - **GA4:** `gtag.js` loads only after analytics consent (Consent Mode "basic", so nothing is sent before consent). Events: page views, `view_item`, `add_to_cart`, `begin_checkout` and `purchase`.
  - **Meta Pixel:** loads only after marketing consent. Events: `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout` and `Purchase`.
  - **Conversions API:**
    - The server sends `Purchase` once the payment is confirmed, only if the buyer had given marketing consent at checkout.
    - It uses the same `event_id` as the browser Pixel, so Meta counts it once.
    - Email, phone and account ID are SHA-256 hashed. No IP address is sent.
  - **IDs at runtime:** `GA4_MEASUREMENT_ID`, `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` are read by the server at request time, so one Docker image serves every environment. Each feature is off while its value is unset (doc/10 A11).
  - **Exit check:** a Playwright test records every request and fails if any goes to Google or Meta before consent, then checks that the scripts load after "Accept all".
- **5c, built 2026-10-16** ([ADR-027](adr/0027-phase-5c-consent-analytics-contact-decisions.md)):
  - **Consent banner:** Accept all, Reject all and Choose; "Cookie settings" in the footer; append-only `consent_records`.
  - **GA4 and Meta Pixel:** loaded only after consent; product view, add to bag, checkout and purchase events.
  - **Conversions API:** server-side Purchase for consenting buyers, deduplicated with the Pixel (unverified until A11).
  - **Contact form:** on `/contact`, with the Admin → Messages inbox and an email to the support address.
  - **Phase 5 is complete.** Every exit criterion has a test: the exchange journey (E2E), no trackers before consent (E2E, desktop and mobile), and the OTP limits (integration).
- **Assumptions** (tell me if any is wrong):
  - Categories get an "exchangeable" switch; innerwear is off.
  - Customers request an exchange from the order page, within the window, once the parcel is delivered.
  - Replacement stock is held at approval.
  - QC happens on the admin exchange page.
  - Photos are optional, up to 3.
  - Review prompts go out 5 days after delivery.
  - Tracking links in messages use a signed token, so customers don't need to sign in to see a parcel's progress.


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

**Plan (written 2026-10-17, before building):**
- **Owner decisions (2026-10-17):**
  - **Delivery:** three slices with a review stop after each:
    - 6a: page builder, revisions and workflow, preview, scheduling;
    - 6b: media library, navigation, site settings, pages and SEO, redirects;
    - 6c: blog and RSS.
  - **Publishing:** Content Managers and Super Admins publish or schedule directly. Content Editors submit for review, and a manager publishes or sends it back.
  - **Blog:** in this phase (6c).
- **6a plan:**
  - **Pages list** (`/admin/cms`): every page with its status, a "needs review" filter, and a "new page" form (landing or static; policy pages arrive in 6b).
  - **Page builder** (`/admin/cms/pages/[id]`):
    - sections reordered by drag and drop (dnd-kit, keyboard accessible) or up/down buttons;
    - add, duplicate, hide and delete sections;
    - a form for each of the 12 block types, with pickers for media (choose or upload), products, collections and categories;
    - errors shown on the section they belong to, checked with the same rules the server uses.
  - **Autosave:** changes save as the working draft about 2 seconds after typing stops. The working draft is edited in place; submitting, publishing or scheduling freezes it as a numbered revision. If someone else saved in the meantime, the editor is told to reload rather than overwrite.
  - **Workflow:**
    - draft → submitted for review → published or scheduled (managers), or sent back with a note;
    - unpublish, archive (not the home page);
    - restore: copy any revision into a new draft.

    Every step is audited and checked against the role.
  - **Revision history:** each version with its author, date, status and note, and a summary of what changed (sections added, removed, edited or moved; SEO changed).
  - **Preview:** a signed link (valid 24 hours, no sign-in needed) that renders exactly that revision with the storefront's own components. The builder shows it side by side, with a desktop and mobile toggle.
  - **Scheduling:** pick a date and time in IST. A `cms.publish-scheduled` job runs every minute, publishes what is due and clears the caches on every replica. A "Scheduled" page lists what is coming up.
  - **Exit check (E2E):** a manager edits the home page and publishes; both web replicas show the change within 10 seconds, with no rebuild. Playwright starts a second replica and a worker that only clears caches.
- **6a, built 2026-10-17** ([ADR-028](adr/0028-phase-6a-page-builder-workflow-decisions.md)):
  - **Pages list** with "needs review" and "scheduled" views, and a new-page form.
  - **Builder:** drag-and-drop or button reordering; add, duplicate, hide and delete; forms for all 12 section types with media, product, collection and category pickers; errors shown on their section; autosave with conflict detection.
  - **Workflow:** submit, withdraw, send back, publish, schedule, cancel, unpublish, archive and restore pages, and restore old versions. All audited and role-checked.
  - **History** with a change summary per version. **Preview** side by side (desktop and mobile) and as a shareable 24-hour link.
  - **Scheduling:** a job every minute, and a "Scheduled" overview.
  - **Exit check passes:** an E2E test publishes twice and sees each change on both replicas within 10 seconds.
- **6b plan and owner decisions (2026-10-17):**
  - **Redirects:** changing the address of a page, product, collection or category adds a permanent (301) redirect from the old address automatically. Chains collapse, so old links never hop twice. A Redirects screen lists them with hit counts and lets staff add their own (e.g. `/sale` → `/collections/summer-sale`).
  - **Menus and site settings** use the same workflow as pages: a draft, submit for review, publish or schedule, history and preview.
  - **In-use content is never deleted:**
    - deleting an image, or archiving a collection, that live content uses is blocked;
    - a "where used" list shows the products, pages and menus using it.
  - **Media library** (`/admin/media`):
    - grid or list, search, and an "unused" filter;
    - upload several files with progress;
    - alt text, caption and focal point (click on the image) editing;
    - a "where used" list, and delete.
  - **Navigation** (`/admin/cms/navigation`): the header mega menu (top items, columns of links to categories, collections, pages or URLs, badges and a promo image), plus the footer, mobile and social menus.
  - **Site settings** (`/admin/cms/settings`): brand name, logo, favicon, announcement bar, contact details, social links, grievance officer and default SEO.
  - **Pages and SEO:**
    - policy pages can be created and show "Last updated";
    - page addresses can be changed (with a redirect);
    - per-page canonical URL, alongside title, description, share image and noindex.
  - **Preview** of a menu or settings draft shows the home page wrapped in the draft header and footer.
- **6b, built 2026-10-21** ([ADR-029](adr/0029-phase-6b-media-navigation-redirects-decisions.md)):
  - **One workflow** for pages, menus and site settings: draft, review, schedule, publish, history and preview.
  - **Menus:** header mega menu (items, columns, links, badges, promo image) and footer.
  - **Site settings:** brand, logo, favicon, announcement bar, contact, social links, grievance officer and SEO defaults.
  - **Media library:** grid or list, search, an "unused" filter, upload with progress, alt text, caption, focal point, "where used" and delete.
  - **Redirects:** automatic on page, product, collection and category address changes (no chains), a Redirects screen, and real 301/302 responses from the proxy.
  - **Pages:** policy pages with "Last updated", address changes, canonical URLs.
  - **Exit criterion met:** an image or collection in use can't be deleted or archived, and the message names where it's used (integration tests).
- **6c plan and owner decisions (2026-10-21):**
  - **"The Journal"** at `/journal`:
    - posts at `/journal/<post>`;
    - categories at `/journal/category/<slug>`, tags at `/journal/tag/<slug>`, authors at `/journal/author/<slug>`;
    - RSS at `/journal/rss.xml`.
  - **Posts** follow the same workflow as pages: draft, review, schedule, publish, history and preview.
    - A post has a title, an address, an excerpt, a cover image, an author, a category, tags, search settings, and a body of blocks.
    - Text blocks use the existing rich-text editor.
    - Image blocks have a caption.
    - **Shoppable product blocks** show live product cards.
    - **YouTube:** nothing loads until the reader presses play, then the video plays from `youtube-nocookie.com`.
    - **Instagram:** shows only after marketing-cookie consent (Instagram sets tracking cookies); before that, a link to open it on Instagram.
  - **Authors** are separate profiles (name, bio, photo), optionally linked to a staff account, so guest writers work too.
  - **No comments.**
  - **Taxonomy:**
    - Managers edit categories and authors on a "Journal settings" screen. Editors can add tags while writing.
    - Changing the address of a live post, category or author adds a redirect.
    - A category or author that is still used can't be deleted.
  - **Search engines:** `BlogPosting` structured data, posts in the sitemap, and reading time shown.
  - **Exit check (E2E):**
    - a post published from the admin appears on `/journal` and in the RSS feed on both replicas within 10 seconds;
    - a YouTube block makes no request to YouTube until it's played.
- **6c, built 2026-10-21** ([ADR-030](adr/0030-phase-6c-journal-decisions.md)):
  - **The Journal** at `/journal`, with category, tag and author pages, an RSS feed, sitemap entries and `BlogPosting` structured data.
  - **Stories** use the shared workflow (review, schedule, publish, history, preview). Blocks: text, image, shoppable products, YouTube (nothing loads until play) and Instagram (only after marketing consent).
  - **Admin:** story list, editor, and an authors, categories and tags screen. Address changes redirect; anything in use can't be deleted.
  - **Exit checks pass (E2E):** a published story is on `/journal` and in RSS on both replicas within 10 seconds, and YouTube makes no request before play.
  - **Phase 6 is complete.**
- **Assumptions** (tell me if any is wrong):
  - Redirect changes reach every replica within 30 seconds. Each replica's request proxy keeps the list in memory and reloads it every 30 seconds, so a redirect costs no database query and returns a real 301.
  - Only Content Managers and Super Admins edit redirects.
  - There are no review emails yet. Pending reviews show as a count on the CMS pages list.
  - Preview links can be opened by anyone holding them until they expire, so they can be shared with someone outside the admin.
  - Store Admins keep read-only access to the CMS, as now.

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

**Plan (written 2026-10-21, before building):**
- **Owner decisions (2026-10-21):**
  - **Edge server:** open-source Nginx in place of Caddy (owner decision 2026-10-21, after the plan was written). Deploys mark a replica `down` and reload Nginx gracefully.
  - **Delivery:** two slices with a review stop after each:
    - 7a: everything that lives in the repository, proven on a developer machine;
    - 7b: the real server, run together with the owner once the accounts exist.
  - **Server:** a Bluehost self-managed VPS in Mumbai.
  - **Off-server backups:** Cloudflare R2.
  - **Monitoring:** Sentry SaaS for errors and UptimeRobot for uptime, both on free tiers.
- **Bluehost points to confirm before 7b** (the scripts don't depend on any of them):
  - an Ubuntu 24.04 LTS image;
  - a plan with at least 8 vCPU / 16 GB (4 vCPU / 8 GB is the floor, with one web replica);
  - the Mumbai location.

  The scripts assume no provider firewall API or snapshots: ufw on the server is the firewall, and our own backups are the recovery path. Outbound port 25 is usually blocked on VPS plans; that's fine because email goes through the SMTP provider on 587 or 465.
- **7a plan (repository, verified locally):**
  - **`compose.yaml`** as in 07 §2:
    - nginx, web_a, web_b, worker, postgres (Postgres 18 + pgBackRest), backup (restic + pg_dump + supercronic), and migrate (tools profile);
    - internal `backend` network, so Postgres has no route out and no published port;
    - health checks, memory limits, log rotation, read-only root filesystems, `no-new-privileges`.

    A `compose.local.yaml` override makes it run on a laptop: a self-signed certificate in place of the Origin CA, a local S3 gateway (versitygw) in place of R2, and Mailpit for alert emails.
  - **Nginx configuration:**
    - TLS with the Origin CA certificate;
    - the real visitor IP taken only from Cloudflare's ranges;
    - HSTS;
    - body limits (2 MB, 15 MB for staff uploads, 8 MB for customer photos);
    - `/media/*` served directly with long caching;
    - load balancing across both replicas, with retries of safe requests;
    - `/api/internal/*` blocked.
  - **Content Security Policy** (doc/08 lists it but it isn't built yet): an allow-list without nonces, so cached page shells keep working (owner decision 2026-10-21).
  - **Sentry** in web and worker:
    - switched off unless `SENTRY_DSN` is set;
    - release = the deployed git SHA;
    - personal data scrubbed before sending (emails, phone numbers, cookies, auth headers, tokens in URLs, request bodies);
    - a low trace sample rate.
  - **Ops alerts:**
    - a worker job every 15 minutes emails `OPS_ALERT_EMAIL` about dead-lettered jobs, stuck queues and stale backups (no success in 26 hours);
    - a host cron script checks disk over 80 %, memory, container restarts and the certificate's expiry.
  - **Scripts** in `ops/`, all checked with shellcheck:
    - `bootstrap.sh` (Ubuntu updates, unattended upgrades, deploy user, SSH keys only, Docker, ufw with 443 from Cloudflare only, swap, time sync);
    - `deploy.sh`, `rollback.sh` and `smoke-test.sh` (07 §4);
    - `backup-now.sh`, `restore.sh` (point-in-time or latest; media) and `restore-drill.sh`;
    - `update-cloudflare-ips.sh`;
    - `host-check.sh`.
  - **Backups** (07 §6):
    - pgBackRest to R2, encrypted: full weekly, differential daily, and continuous WAL;
    - a nightly `pg_dump` and a media snapshot through restic to R2;
    - retention, pruning, and a weekly `restic check`;
    - every run records its status for the alert job.
  - **Runbooks** in `doc/runbooks/`:
    - first server setup, deploy, rollback, restore, a monthly restore drill;
    - incident first steps, secret rotation, adding a replica, moving media to R2.
  - **Local proof (the 7a exit check):**
    - the stack starts from empty volumes, runs migrations and becomes healthy;
    - a deploy of a new build while k6 sends traffic through Nginx has zero failed requests;
    - rollback to the previous build takes under 2 minutes;
    - backup → write more orders → point-in-time restore into a separate Compose project → row counts, latest order and media checksums match, with RPO and RTO measured;
    - Postgres is unreachable from the host, `/api/internal/*` returns 404 through Nginx, and the security headers and CSP are present;
    - CI also builds the production image and validates the compose file.
- **7b plan (on the server, with the owner):**
  - **Accounts and keys from the owner:**
    - the VPS;
    - the domain on Cloudflare and an Origin CA certificate;
    - an R2 bucket with an access key, and bucket lock rules;
    - a Sentry project DSN;
    - an UptimeRobot monitor;
    - SMTP for alert emails.
  - **Bring the server up:** bootstrap the server, make the first deploy, then switch on Cloudflare (Full strict, cache rules, WAF, a skip rule for webhooks).
  - **Checks:**
    - the origin can't be reached directly;
    - a deploy under load fails no requests;
    - rollback takes under 2 minutes;
    - a restore drill onto a scratch server succeeds;
    - the alerts reach the owner.
- **7a, built and proven locally on 2026-10-21** ([ADR-031](adr/0031-phase-7a-production-stack-decisions.md); [runbooks](runbooks/README.md)):
  - **Built:**
    - `compose.yaml`, with Nginx, two web replicas, worker, Postgres + pgBackRest, backup, migrate and restore;
    - the Nginx configuration;
    - the CSP;
    - Sentry for server, browser and worker;
    - server checks with alert emails, a System page panel and `/api/health/ops`;
    - the `ops/` scripts and runbooks;
    - a CI job for shellcheck, compose and Nginx validation, and the Postgres image build.
  - **Proven on a laptop**, using a clean clone, a local S3 gateway in place of R2 and seeded demo data:
    - **First deploy:** from empty volumes it builds, migrates, starts, takes the first full backup and passes the smoke test.
    - **Replica swaps under steady traffic (k6, 10 requests a second):** zero failed requests across every swap through Nginx (two swaps, 1,523 requests) and through the earlier Caddy setup (a deploy and a rollback, 5,065 requests).
    - **Rollback:** 35–67 s through Nginx, 53 s earlier (target: under 2 minutes).
    - **Point-in-time restore:** a row written before the target time is back, one written after is gone. 26 s, followed by a fresh full backup on the new timeline.
    - **Restore drill:** restored in 13 s; data loss window 3 minutes; 6 tables and 20 of 20 images match.
    - **Isolation:**
      - no container but Nginx publishes a port;
      - the backend network has no internet;
      - the database superuser can't log in over TCP;
      - `/api/internal/*` returns 404.
    - **Real IP:** a forged `CF-Connecting-IP` is ignored unless the connection comes from a trusted range.
    - **Alerts:** a simulated full disk turned `/api/health/ops` red and produced alert and recovery emails.
  - **Fixed along the way:**
    - Postgres crash-restarted every 10 s while the bucket was unreachable (now runs under an init process).
    - The Docker build had been failing since 6a (`playwright.config.ts` imported from `tests/`).
    - A Node/Nginx keep-alive race caused 502s while a replica was out.
    - The restore drill tore itself down from inside a subshell, and compared only one image.
  - **Not proven locally, moved to 7b:**
    - **Building while serving:** the laptop's 4 GB Docker VM can't build the image and serve traffic at once (requests timed out during the build). Deploys now build in a separate container with low CPU priority and a memory cap. A deploy under load must be re-checked on the 16 GB server.
    - **Server-only parts:**
      - `bootstrap.sh` and `install-timers.sh` (ufw, systemd);
      - Cloudflare;
      - R2 itself;
      - the Sentry DSN;
      - UptimeRobot.
- **Race-condition test campaign (plan written 2026-10-21, before building):**
  - **Owner decisions (2026-10-21):**
    - test at both levels: integration tests on a real Postgres (in CI), and an HTTP suite against the production stack (Nginx and both app copies) with separate signed-in customers firing at the same moment;
    - cover stock, payments, money limits, and accounts and admin;
    - fix every real bug found, each with the test that proves it;
    - work on branch `phase-7a-race-tests` (7a is committed).
  - **The rule every scenario checks:** whatever the timing, the end state is one that could have happened if the requests had come one after another. In particular:
    - stock is never negative and never sold twice;
    - money is never taken without an order or a refund;
    - a limit is never exceeded;
    - every losing request gets a clear message, never a 500.
  - **Stock:**
    - **S1:** 3 customers, 1 unit: exactly one order is placed, the other two are told it's sold out.
    - **S2:** 20 customers, 1 unit: the same.
    - **S3:** 3 customers, 2 units, one buying 2: never more than 2 committed.
    - **S4:** A's reservation expires, B buys the last unit, then A's payment arrives: A is refunded in full automatically and B keeps the order.
    - **S5:** the same, but stock is still there: A's order is confirmed late.
    - **S6:** staff set stock to 0 while 3 checkouts are running: no order beyond the stock on hand, and stock never negative.
    - **S7:** two exchanges want the last replacement size: one gets it, the other is told it's unavailable.
  - **Payments:**
    - **P1:** the webhook and the browser confirmation arrive at the same instant: confirmed once (one stock commit, one email, no refund).
    - **P2:** the same webhook delivered 5 times at once: processed once.
    - **P3:** "Pay" double-clicked: one gateway order. If two payments are captured anyway, the second is refunded automatically.
    - **P4:** the customer cancels while the payment captures: the order ends cancelled with a refund, or confirmed. Never cancelled with the money kept.
    - **P5:** two staff refund the same order in full at once: total refunds never exceed what was paid.
    - **P6:** the reconciliation job and the webhook settle the same payment at once: settled once.
    - **P7:** the order-expiry job and a capture at the same instant: confirmed, or expired with a refund.
  - **Money limits:**
    - **M1:** a coupon with 1 use left, 3 customers at once: 1 redemption.
    - **M2:** the per-customer limit, same customer, two orders at once: 1 redemption.
    - **M3:** a single-use code typed by two customers at once: 1 redemption.
    - **M4:** a ₹500 wallet balance spent by two orders at once: one succeeds, the other is told the balance changed. The balance never goes negative and the ledger adds up.
    - **M5:** an order with wallet credit expires while being cancelled: the credit comes back once.
    - **M6:** a redeemed coupon's order expires while the last use is being taken: the use is released once and the limit still holds.
    - **COD:** there is no cap on the number of COD orders, only a per-order value limit with nothing shared to race on, so there's nothing to test.
  - **Accounts and admin:**
    - **A1:** the same OTP submitted twice at once: one sign-in, the other rejected.
    - **A2:** two sign-ups with the same email (and the same phone) at once: one account, and the other gets a clear error.
    - **A3:** two staff save the same product at once. **Expected finding:** the later save silently overwrites the earlier one. Planned fix: a stale save is refused with "changed by someone else, reload", as in the CMS.
    - **A4:** two managers publish the same CMS draft at once: one publish, one revision.
    - **A5:** two staff adjust the same variant's stock (+5 and −3) at once: both apply (net +2), with two movements.
    - **A6:** a staff invite accepted twice at once: one account.
    - **A7:** two restocks of the same size at once: each waiting customer is emailed once.
  - **How:**
    - **Integration (CI):** `tests/integration/races/*.test.ts`. Requests start together behind a barrier and run on separate database connections. Afterwards the test checks the stock, money and limit invariants in SQL, not only the responses. Each race runs 3 times per test run to catch timing luck.
    - **Production stack:** `npm run test:race` (Playwright project `race`) against the local production stack (`ops/local/init.sh --test-mode`: fake payment, SMS and courier providers).
      - Customers are created with email and password and sign in, in separate browser contexts.
      - Each scenario waits until every customer is on the checkout page, then they all press "Place order" or "Pay" together.
      - Nginx's log must show requests served by both copies.
      - Covers S1, S2, M1, M4, P1 and P3, plus A1 and A3 through the real forms.
    - **Findings:** every bug gets a failing test first, then the fix. Each is listed in ADR-0032 and in the summary.
  - **Exit criteria:**
    - every scenario passes 3 runs in a row at both levels (A2, A6, A7 and S7 at integration level only);
    - the invariant checks find nothing;
    - `npm run check`, integration and E2E stay green.
  - **Not in scope:** the product page opens on the first colour even when it is sold out (seen in E2E). That's a small UX fix to do separately if wanted.
- **Race campaign, built and passing on 2026-10-21** ([ADR-032](adr/0032-race-condition-campaign.md)):
  - **Integration:** 83 tests (`tests/integration/races/`), every scenario 3 times per run, three full runs in a row. Invariants clean.
  - **Proof that the tests catch bugs:** removing the stock reservation's condition, or the payment row locks, fails the matching scenarios every time.
  - **Production stack:** 5 scenarios through Nginx and both app copies (S1, S2 with 20 customers, M1, M4, P1), three runs in a row. Both copies served the checkouts, and invariants were clean afterwards. P3, A1 and A3 are covered at integration level only (ADR-032 says why); A3's form also has an end-to-end test.
  - **Bugs found and fixed:**
    - concurrent checkouts with the same coupon deadlocked (customers saw an error page);
    - a lock conflict could surface as an error page;
    - a staff invitation accepted twice gave a raw database error;
    - a stale product save silently overwrote a newer one;
    - Nginx dropped the port from `Host`, which broke every Server Action on a non-443 port;
    - a used-up coupon at checkout only said "the total changed";
    - the fake payment gateway was per-process (now shared, in the database).
  - **Still last-write-wins:** categories, collections, discounts and settings. The same version pattern applies when needed.

Tasks:
1. **Production `compose.yaml`:**
   - Services: `nginx` (Caddy in the original plan), `web_a`, `web_b`, `worker`, `postgres` (custom image with pgBackRest), `backup`, and `migrate` (tools profile)
   - Networks `edge` and `backend` (internal)
   - Volumes, health checks, restart policies, resource limits, log rotation, read-only root filesystems, `no-new-privileges`
2. **Edge server configuration** (Nginx; originally a Caddyfile):
   - Origin CA TLS
   - Real IP from Cloudflare ranges only
   - Security headers (HSTS, CSP from the app, frame-ancestors, referrer policy, permissions policy)
   - Body limits (2 MB default, 15 MB for `/api/media/upload`, 8 MB for customer photos)
   - `/media/*` static with immutable caching
   - Load balancing with failover; deploys take a replica out of rotation before replacing it
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

**Production-readiness audit (2026-10-22, before building fixes).** The owner asked for a senior-architect and QA audit before go-live. Findings from reading the code, querying the dev database and scanning the last production build:

- **Already verified, no action needed:**
  - **Race conditions:** 27 scenarios at the database level and 5 through Nginx and both app copies (ADR-0032).
  - **Price tampering:** the server recomputes the quote and refuses a total the customer didn't see (integration test).
  - **Payments:** webhooks are signed, deduplicated and idempotent. Reconciliation and expiry jobs catch dropped callbacks.
  - **Access control:** every operation is in the RBAC matrix test, and every API route checks its caller (staff session, signed webhook, signed internal call, or test-only).
  - **XSS and SQL injection:** the only raw HTML is escaped JSON-LD, and there is no raw SQL.
  - **Secrets:** no secret from `.env` appears in the browser bundle (scanned).
  - **Edge and monitoring:** CSP and HSTS are set. Sentry, health endpoints, server checks, backups and restore drills are in place (Phase 7a).
  - **Media:** images are pre-sized WebP with immutable caching behind Cloudflare.
- **Findings, most critical first:**
  1. **Stock can be held hostage.**
     - A signed-in customer can place any number of unpaid orders; each holds up to 10 per line for 15 minutes, renewable by placing again.
     - One account or bot can make a popular item look sold out during a drop.
     - Nothing caps open unpaid orders, and placing orders isn't rate-limited.
  2. **Unprotected expensive public endpoints.**
     - `/api/search/suggest` (full-text and trigram queries on every keystroke) has no limit, though doc/08 says it does.
     - The checkout quote, coupon-apply and place-order actions have none either.
     - Cloudflare's free plan allows one rate-limit rule, already used for sign-in. So a scraper or bot can load the database directly.
  3. **A missing index on a hot path:** `refunds.payment_id`, summed on every cancellation, refund and late payment, inside the order lock.

     Sixty foreign keys have no single-column index. Checked against the code, the others are already covered by composite indexes (coupon redemptions, cart lines), or are only scanned when a user or product is deleted, which is rare.
  4. **A payment-provider outage shows a generic error.** If Razorpay can't create the payment, the customer sees "Something went wrong". It should say payments are briefly unavailable and their items are held for 15 minutes.
  5. **Error screens:** admin, checkout and sign-in have no error screen of their own. An error there replaces the whole page with the global one, losing the header and the way back.
  6. **Admin edits:** categories, collections, discounts and settings still save last-write-wins (products are protected since ADR-0032).
  7. **Dependencies (corrected on inspection):** the 4 moderate `npm audit` advisories come from `drizzle-kit`'s bundled esbuild. `drizzle-kit` is already a dev dependency; it appears under production only because Better Auth declares it (for its schema CLI). It isn't in the standalone server output, so nothing to change.
- **Plan (on approval):**
  - **Fixes:** one slice, with a test proving each:
    - cap open unpaid orders per customer;
    - rate-limit order placement, quote and coupon attempts, and search suggestions;
    - add the hot-path indexes (one migration, created concurrently where tables may be large);
    - a friendly message when the payment provider fails;
    - error screens for admin, checkout and sign-in;
    - version checks for categories, collections and discounts.
  - **On the real server (7b and Phase 8):**
    - k6 load test of browsing, search and a checkout burst;
    - Lighthouse and axe on every template;
    - security headers checked on the live domain;
    - `nmap` from outside;
    - Trivy image scan;
    - a real Razorpay test payment and a Shiprocket test shipment.

- **Audit fixes, built 2026-10-22** (owner decisions: at most 2 unpaid orders, "balanced" limits, all fixes):
  - **Unpaid orders:** at most 2 open per customer, counted under a lock on the customer's row, so three tabs at once still get 2.
  - **Rate limits, shared by both app copies** (`app_rate_limits`):
    - search suggestions: 60 a minute per visitor;
    - checkout quotes: 60 a minute;
    - wrong coupon codes: 10 a minute;
    - placing orders: 5 per 10 minutes per customer.
  - **Index:** `refunds_payment_idx`.
  - **Payment outage:** the message is now "Payments are briefly unavailable. Your items are held for 15 minutes…" (`PAYMENT_UNAVAILABLE`, 503). The order and its stock stay, and Pay works again once the provider is back.
  - **Error screens:** admin, checkout and sign-in each have their own, inside their layout.
  - **Stale saves refused for categories, collections and discounts**, as for products:
    - a collection's details, rules and product list share one version;
    - the worker's automatic refresh doesn't count as an edit;
    - the product form now reads its version from the page, so publishing then editing works.
  - **Tests:** `tests/integration/hardening.test.ts` and `payment-outage.test.ts`.
  - **Also fixed:**
    - an empty value in the env counts as not set;
    - E2E runs with Turnstile off, because once real keys were added to `.env`, every test sign-up was refused by the challenge.

**Owner's size charts (2026-10-23).** The four charts from the owner's artwork replace the demo tops chart where it applies (migration `0016_owner_size_charts.sql`, also used by the seed):
- Oversized Hoodie → Hoodies.
- Oversized Sweatshirt → Sweatshirts.
- Oversized T-Shirt → Oversized and Graphic T-Shirts.
- Regular Fit T-Shirt → Regular Fit and Polo T-Shirts.

Notes:
- Charts are stored in inches. The size guide has an Inches/CM switch; converting with × 2.54, rounded to 0.1, reproduces the artwork's cm tables exactly (`src/lib/size-units.test.ts`).
- A chart is linked only where a category has none, so a chart staff already chose is never replaced. Parent categories keep the general chart.
- Customers now see "2XL" instead of "XXL". The value's slug stays `xxl`, so filter links and variants are unchanged, and past orders keep the label they were bought under.

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


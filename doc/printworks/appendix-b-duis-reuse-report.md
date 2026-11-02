# Appendix B. Duis-store reusability report

> Part of the [DUIS Printworks plan](README.md). § numbers refer to [development-plan.md](development-plan.md).

## B.1 Module classification (final)
| Class | Meaning |
|---|---|
| **D** | Reuse directly |
| **M** | Reuse with modifications |
| **E** | Exists, but needs extending |
| **N** | Build new |
| **X** | Not required |

| Module | What Duis has | Class | Action |
|---|---|---|---|
| Operation framework | `server/operation.ts`, `action.ts`, `errors.ts`, `http.ts` | D | Copy |
| Database layer | `server/db/*` (pool, transactions, versioning, invariants), `db/schema/columns.ts` | D | Copy; fresh baseline |
| Authentication | Better Auth: email, phone OTP, Google, admin, TOTP, captcha, OTP guard | D/M | Copy; 2FA issuer and branding; new secrets |
| Access control | `roles.ts`, `permissions.ts`, RBAC test | M | 11 staff roles plus customer; new resources (§7) |
| Audit, security | `server/audit.ts`, `server/security/*`, CSP, Sentry scrubbing | D | Copy |
| Jobs and worker | pg-boss, transactional enqueue, queues, worker | D/M | Copy; edit the queue list (§9.4) |
| Cache and search | Redis handler, revalidation fan-out, Elasticsearch, Postgres full-text search | M/X | Keep tags, revalidation and Postgres search; **drop** Redis and Elasticsearch |
| Customers | Profile, addresses, consent, deletion, COD block | E | Add business details and GSTIN |
| Catalogue | Categories, attributes, products, variants, size charts, admin editor | E | Stations, MOQ and step, positions, slabs, mockups, kits (components) |
| Inventory | Levels, reservations, movements, low stock, Redis stock cache | M | Per-size and per-kit-item reservations; kit availability from components; `reprint` movements; Redis stock cache dropped |
| Collections, discounts | Manual and rule-based collections; coupons and automatic discounts | D | Copy |
| Media library | sharp pipeline, renditions, alt text and focal point, "where used" | D | Copy (ImageKit not copied) |
| Customer uploads | `media/customer-photos.ts` (images, 8 MB, WebP, private) | M→N | Pattern for the new artwork module |
| Private storage | `storage/private.ts` (local; labels and photos) | E | R2 adapter, new areas |
| Cart | Guest cookie, merge, limits | M | Designs plus size mix |
| Pricing engine | Pure `quote()`: discounts, GST by HSN with per-piece threshold, shipping, partial COD, wallet, hash | E | Slabs and add-ons; remove the wallet |
| Checkout | Idempotent placement, reservations, Razorpay, partial COD, international | M | GSTIN and billing, designs |
| Payments | `payments/gateway.ts` (Razorpay, fake), webhooks, reconciliation, refunds | D | Copy; add `quote_id` and `balance` |
| Orders | Lifecycle, admin, notes, staff cancel and refund, COD remittance | E | Design and production states, `DPW-` prefix, quote link |
| Shipping | `shipping/provider.ts` (Shiprocket, fake), shipments, tracking, RTO, export | D/M | Copy; e-way bill; replacement shipments |
| Exchanges | Request → QC → replacement | X | Not copied; the replacement-shipment and pay-an-existing-record patterns live on in shipping and payments |
| Wallet | Closed-loop ledger | X | Not copied |
| Back-in-stock alerts | 0 → >0 notifications | X | Not copied |
| Reviews | Verified buyers, photos, moderation | D/M | Copy; drop `fit` |
| Wishlist | — | D | Copy |
| Notifications | SMTP and React Email (worker), MSG91 WhatsApp and SMS, logs, quiet hours | D/M | Copy; new templates |
| Marketing | Newsletter, abandoned cart | D | Copy |
| Consent and analytics | Banner, records, GA4, Meta | D | Copy; new IDs |
| Contact | Form and Messages inbox | D | Copy (quote requests separate) |
| CMS and Journal | Builder, workflow, revisions, preview, menus, settings, redirects, blog | D/M | Copy; 3 new blocks |
| Settings | Store and legal, shipping, COD, tax rules, notifications, health | M | Fields per §8.3 |
| Staff, system, audit | Invitations, roles, 2FA reset; queues, dead letters, webhooks | D | Copy |
| Reports | Dashboard, sales, GST CSV, COD, safe CSV | M/E | New production, quote, design and accounts reports |
| Admin UI kit | Sidebar, data table, column toggle, command palette, Tiptap, chart; 35 shadcn components | D | Copy; restyle |
| Storefront layout | Header, mega menu, footer, mobile nav, search, card, price, breadcrumbs | M | Restyle; per-piece price display |
| Emails | `src/emails/*` | M | Rebrand; new templates |
| PDF | `lib/pdf.ts` (Latin-1 text only) | X→N | `@react-pdf` documents in the worker |
| Ops | Dockerfile, Compose, Nginx, Postgres image, backups, deploy, rollback, restore, runbooks, CI | M | Rename; single web container; artwork body limit; new secrets |
| Tests | Vitest harness, helpers, race support, Playwright support | M | Copy the harness and the suites for reused modules |
| Seed, migrations | Fashion seed; 40 migrations | X | New seed; fresh baseline |
| Print-specific | — | N | Artwork, mockups, proofs, quotes, production, invoices, business details, reorder, business hours |

## B.2 Files to reuse (copy from the pinned Duis commit; currently `d501c03`)
- **Tooling:**
  - `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.nvmrc`, `.gitignore`, `.dockerignore`, `components.json`;
  - `vitest.config.mts`, `playwright.config.ts`, `.github/workflows/ci.yml`;
  - `next.config.ts` (**drop `cacheHandlers`**);
  - `scripts/{build-server-bundles.mjs (drop the cache-handler bundle), start-standalone.mjs, stubs/server-only.mjs, postprocess-auth-schema.mjs, seo-crawl.mjs}`.
- **Server:**
  - `src/server/{operation,action,errors,http,audit,health,site-url}.ts`;
  - `src/server/db/*`;
  - `src/server/jobs/{boss,enqueue,queues}.ts`;
  - `src/server/observability/*`;
  - `src/server/security/*`;
  - `src/server/auth/*`;
  - `src/server/notifications/*`;
  - `src/server/storage/{local,private}.ts`;
  - `src/server/cache/{tags,revalidate}.ts`;
  - `src/server/redirects/*`.
- **Config and lib:**
  - `src/config/*`;
  - `src/lib/*` (except `owner-size-charts.fixture.ts`, `wallet-reasons.ts`, and the ImageKit branch of `image-loader.ts`).
- **Components:**
  - `src/components/{ui,admin,layout,product,brand}/*` (restyle `brand`);
  - `src/components/{breadcrumbs,json-ld,media-image,media-thumb,page-skeleton,rich-text,turnstile,newsletter-form,instagram-embed}.tsx`;
  - `src/components/{payment,customer}/*`.
- **Emails, worker, CLI:** `src/emails/*`, `src/worker/{index,handlers,pg-listen,sentry}.ts`, `src/cli/*`.
- **Features:**
  - `src/features/{staff,system,redirects,collections,discounts,media (minus ImageKit),marketing,analytics,payments,shipping,cms,contact,reviews,wishlist,auth,customers,cart,checkout,pricing,orders,catalog (minus search/),inventory,settings,reports}`.
  - From here, the B.3 changes are applied.
- **Schema:** `src/db/schema/*` except `alerts.ts`, `wallet.ts` and `exchanges.ts`; `auth.ts` is regenerated.
- **App routes:**
  - `src/app/{(storefront),(auth),(checkout),(preview),admin}/**` (except admin `exchanges` and the wallet pages);
  - `src/app/api/**`;
  - the root layout and globals.
- **Tests:**
  - `tests/helpers/*`, `tests/integration/global-setup.ts`, `tests/integration/races/support.ts`, `tests/e2e/support/*`;
  - suites for the reused modules (rbac, jobs, notifications, smtp, media, cms, journal, contact-consent, hardening, payment-outage, ops-checks, database, collections, inventory, storefront-customer).
- **Ops:**
  - `Dockerfile`, `compose*.yaml`;
  - `docker/{nginx,postgres}/*`;
  - `ops/*`;
  - `doc/runbooks/*` (as templates).

**Not copied:**
- `src/db/migrations/*`, `src/db/seed/*`, `public/brand/*`;
- `scripts/{fetch-demo-photos,make-brand-assets}.mjs` (replaced by a Printworks version);
- `src/features/{alerts,exchanges,wallet}`, `src/features/catalog/search/*`, `src/worker/{search-indexer,stock-listener}.ts`;
- `src/server/cache/{redis,shared-cache-handler,next-cache-handler}.ts`, `src/features/inventory/stock-cache.ts`;
- `src/server/storage/imagekit.ts`, `src/features/media/move-to-imagekit.ts`;
- Duis `doc/*` decisions and RBAC snapshots;
- fashion end-to-end specs (`exchange.spec.ts` and specs tied to the seed).

## B.3 Modules that need changes
- **Config and auth:**
  - `config/{env,site,store-policy,routes}.ts`;
  - `server/auth/{options (2FA issuer),roles,permissions}.ts`.
- **Jobs and notifications:**
  - `server/jobs/queues.ts`, `worker/handlers.ts`;
  - `server/notifications/{templates,whatsapp}.ts`;
  - `server/storage/private.ts` (R2).
- **Catalogue and schema:**
  - `features/catalog` and `db/schema/catalog.ts`;
  - `db/schema/{orders,payments,shipping,settings,customers,cart}.ts`.
- **Commerce:** `features/{cart,pricing/engine.ts,checkout,orders,customers,settings,reports,shipping (e-way bill),reviews (drop fit)}`.
- **UI:** `components/{layout,brand,product}`, `src/emails/*`, `app/globals.css`, the storefront, checkout and admin routes.
- **Removing Redis:**
  - drop the `stock-cache` exports from `features/inventory/index.ts`;
  - the product page (`app/(storefront)/products/[slug]/page.tsx`) reads stock through `getAvailability` directly, which is what `getCachedAvailability` already falls back to;
  - remove `closeRedis` from `worker/index.ts` and the Redis check from `features/system/ops-checks.ts`.
- **Ops:** `duis_*` database roles, the `duis-backup` script, Compose project names, Nginx hosts and body limits, CSP hosts, `x-duis-*` HMAC headers → `dpw`.

## B.4 New modules
- `src/features/{artwork,mockups,proofs,production,quotes,invoices,documents}`
- Business details and reorder live in the existing `customers` and `cart` modules; kits live in `catalog`, `inventory` and `production`.
- `src/lib/{gstin,working-hours,slabs}.ts` (pure, each with unit tests)
- `src/server/storage/r2.ts`
- New admin routes: `/admin/{designs,quotes,production,invoices,stations}`
- New storefront routes: `/quote`, `/quotes/[token]`, `/proof/[token]`, `/account/{quotes,artwork,business}`

## B.5 Dependencies and integrations to set up
**npm packages:**
- **Add:** `aws4fetch`, `pdfjs-dist`, `@napi-rs/canvas`, `@react-pdf/renderer`. Check each version on npm when adding it.
- **Remove:** `@elastic/elasticsearch`, `redis`.

**Separate configuration** (nothing shared with Duis production):
- VPS; domain and Cloudflare zone; Origin CA certificate; Turnstile.
- R2 artwork and backup buckets, with their own keys.
- Postgres roles and backup stanza.
- Razorpay keys and webhook; Shiprocket pickup and webhook.
- MSG91 WhatsApp number and templates; DLT header and templates.
- SMTP domain; Google OAuth.
- GA4, Meta and Sentry.
- All secrets newly generated: `BETTER_AUTH_SECRET`, `INTERNAL_REVALIDATE_SECRET`, database passwords.
- GitHub repository, CI secrets and branch protection.

**Shared only where the law and the vendors allow it:** the legal entity, GSTIN, DLT principal entity and Meta Business account.

## B.6 Technical risks
Covered in §16. The main ones are:
- leftover Duis branding;
- fashion assumptions buried in the code;
- artwork is not an ordinary image;
- order states needing to coexist with the expiry jobs;
- invoicing as a compliance commitment;
- Next.js 16 specifics;
- over-building the infrastructure;
- no shared upstream after the copy: Duis fixes won't flow to Printworks automatically, which is accepted.

## B.7 Effort with and without reuse (person-weeks, one senior engineer)
| Area | From scratch | Reusing Duis |
|---|---|---|
| Foundation: auth, roles, operations, jobs, audit, security, CI | 8–11 | 1.5–2.5 |
| Ops: Docker, Nginx and Cloudflare, backups, deploy | 4–6 | 1–1.5 |
| Catalogue, media, collections, CMS and blog, SEO | 12–15 | 3–4.5 |
| Commerce core: cart, pricing and GST, discounts, checkout, Razorpay, partial COD, orders, refunds, international | 11–14 | 3.5–5 |
| Shipping, notifications, reviews, marketing, consent, contact | 6–8 | 1.5–2.5 |
| Admin portal: shell, tables, settings, staff, reports, system | 7–9 | 1.5–2.5 |
| **Platform subtotal** | **48–63** | **12–18.5 (≈ 70–75% saved)** |
| Print-specific: artwork and R2 3–4 · mockups 2–3 · slabs and positions 2–3 · proofs, cancellation, business hours 3–4 · production 3–4 · PDFs 1–2 · invoices 3–4 · quotes 4–5 · business details 1 · reorder and library 1–2 · kits 1.5–2 | 24.5–34 | 24.5–34 |
| **Total** | **≈ 73–97** | **≈ 37–52 (≈ 46–50% less)** |

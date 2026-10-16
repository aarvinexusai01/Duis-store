# ADR-0020: Phase 2 storefront decisions

- Status: Accepted
- Date: 2026-10-15
- Deciders: Engineering (Phase 2). Brand direction was chosen by the owner: Black + Rust palette, condensed display type with a clean sans, a "DUIS" text wordmark, and light pages with dark chrome.

## Context

The storefront is the first surface customers see. It had to look premium, be fast on mid-range Android phones, and fit the constraints already set:

- Cache Components is on, and builds have no database (ADR-016).
- Security is enforced in services (doc/08).
- The project must never invent delivery estimates or prices.

Building it raised questions the plan left open, and showed where library behaviour differed from what the plan assumed. Every decision below was checked by a production build, an integration test or a Playwright run.

## Decisions

### Brand and design system

**Decision.** Tokens are defined in `globals.css`:

| Token | Value | Notes |
|---|---|---|
| ink | `#111111` | dark chrome |
| paper | `#f4f1ea` | page background |
| rust | `#b43b0b` | accent; 5.2:1 on paper, 5.9:1 with white text |
| mustard | `#e0a526` | badges only |
| radius | 2px | |

- Fonts: Anton for display and Geist for body, both via `next/font`.
- There is no dark mode. The `dark:` variant applies only under `.dark`, which is never set. `next-themes` was removed and the shadcn `sonner` wrapper patched to match.

**Why.** These are the owner's choices. The colour contrast meets WCAG AA.

### Rendering model

**Decision.** Every storefront route is partially prerendered:

- The static shell (wordmark, icons, search box, skeletons) is built at build time.
- Each database-backed island calls `await connection()` inside its own `<Suspense>`, then reads through `"use cache"` functions tagged for revalidation.
- Dynamic routes pass the `params` promise into a Suspense boundary (no `generateStaticParams`).

**Why.**
- ADR-016 forbids database access during the build.
- Next.js 16.4 requires dynamic params inside Suspense when `generateStaticParams` is absent, and errors on an empty `generateStaticParams`.
- Cached islands still serve from memory after the first request.

### What is cached

**Decision.** These reads are cached with tags:

| Read | Tags |
|---|---|
| Catalogue tree | `categories:tree` |
| Listings | `products:list` plus the collection tag |
| Product detail | `product:{id}`, or `products:list` while not found |
| Resolved CMS pages and menus | the CMS tag plus the catalogue tags |
| Collections | collection tags |

These are deliberately **not** cached:
- search results;
- stock levels on the product page (read fresh on every request and streamed into the picker);
- the cart;
- session-derived UI.

**Why.**
- Arbitrary search queries would flood the cache.
- doc/06 requires stock that is never cached.
- Personal data must never enter a shared cache.

### Personal UI on cacheable pages

**Decision.** Personal UI uses small request-time islands:
- `HeaderCart` (the bag count and drawer);
- `WishlistSync` (pushes the saved product ids into a client store that every heart button reads).

**Why.** Listings and product pages stay one cache entry each, whoever is viewing. One session lookup per request is memoised with React `cache()`.

### Feature boundaries

**Decision.**
- Cross-domain UI lives in `src/components`: product card, layout, newsletter form, rich text.
- Product-page widgets that combine catalogue, cart, shipping and wishlist live next to their route, in `products/[slug]/_components`.
- CMS block renderers live in `features/cms/ui/blocks.tsx`. The per-block folder split (schema, editor, render, refs) comes with the editors in Phase 6.

**Why.** ESLint enforces that features import each other only through their public index. Putting composite UI in shared or route code keeps that rule intact without exceptions.

### Listing and search code location

**Decision.** Listings, facets and search stay in `features/catalog/storefront.ts`. There is no `features/search` module yet.

**Why.** There is one search backend (PostgreSQL FTS plus trigram). The `SearchProvider` split happens if an external engine is ever added.

### Listing URLs and SEO

**Decision.**
- Filters, sort and page are query parameters with a canonical serialisation (`lib/listing-params.ts`). Facet links are plain `<a rel="nofollow">`.
- A filtered or re-sorted listing is `noindex, follow`, with its canonical pointing at the plain listing.
- Search pages are always `noindex`.

**Why.** Shareable URLs that work without JavaScript, and exactly one indexable URL per category.

### Variant selection on the product page

**Decision.**
- The selection lives in client state, mirrored to `?color=&size=` with `history.replaceState`.
- The page's canonical URL has no parameters. The picker rules are pure functions in `lib/variant-selection.ts`, with unit tests.
- Sold-out sizes are disabled. Colours always stay selectable so their photos can be viewed.
- "Only N left" appears only at 5 units or fewer, using the real count.

**Why.** Shareable variants without making the cached page vary by query. Honest scarcity messages.

### Guest cart

**Decision.**
- A random 256-bit token is stored in an httpOnly `duis_cart` cookie; the database stores only its SHA-256. There is no signing key.
- A guest cart is merged into the account in one place: `/auth/complete`, where every sign-in method lands (phone OTP, email, Google, and the verification link).
- Merge rules:
  - With no customer cart, the guest cart is adopted and its token hash cleared.
  - Otherwise the guest lines are added, capped at 10 per line, and the guest cart is marked `merged`.
- Cart actions also merge if a stale cookie is present.

**Why.**
- An unguessable bearer token gives the same protection as a signed cookie with less key management.
- Clearing the hash on adoption stops a later guest on a shared device from seeing the account's bag.
- Merging is idempotent.

### Cart validation

**Decision.**
- Adding or raising a quantity checks live stock and the 10-per-line maximum (the latter is also a database CHECK). Lowering and removing are always allowed.
- Cart lines have no stored prices: the live variant price is shown and checkout re-prices.
- Lines that became unavailable are flagged and excluded from totals.
- Shipping shows "Free" only at ₹999 or more, otherwise "Calculated at checkout".

**Why.** Prices and courier rates are never invented (doc/03).

### Sign-in flow

**Decision.**
- The forms call the Better Auth **browser client**, which goes through `/api/auth`. Server Actions are not used for auth calls.
- After sign-in, the browser does a full navigation to `/auth/complete?next=`, where `next` is validated as a same-site path.

**Why.** Better Auth's rate limits and origin checks run in its HTTP handler; server-side `auth.api.*` calls skip them. OTP-send limits matter for SMS cost and abuse.

### Shipping estimates

**Decision.**
- A `ShippingProvider` interface is added.
- The `fake` provider answers from fixed rules and is **refused in production** by env validation (`SHIPPING_PROVIDER`).
- Answers are cached for 24 hours in `pincode_serviceability`.
- `/api/serviceability` is rate limited in-process (20 requests per minute per IP).

**Why.** The page can be built and tested now without inventing estimates for real customers. Shiprocket replaces the fake provider in Phase 3.

### Newsletter

**Decision.**
- Double opt-in. The response is the same for new, pending and confirmed addresses.
- Confirmation emails are limited to one per address per 10 minutes.
- The emailed link opens a page, and the customer confirms with a click.

**Why.**
- DPDP consent.
- No address enumeration and no inbox flooding.
- Email link scanners can't confirm subscriptions.

### Account

**Decision.**
- Addresses are country-aware: Indian addresses need a PIN, a state and a +91 mobile; others an E.164 phone. A PIN prefix suggests the state, as a prefill only.
- Marketing consent is per channel: a timestamp is kept while on and cleared when withdrawn.
- Account deletion is a recorded request that support completes.
- Phone-only accounts show "no email" instead of the `.invalid` placeholder address.

**Why.**
- ADR-018 (worldwide shipping).
- DPDP.
- Changing email and adding an email to a phone account are deferred to Phase 5, with support tooling.

### Metadata base URL

**Decision.**
- `metadataBase` reads `process.env.APP_URL` at module load.
- Every indexable page resolves its metadata per request, so canonical and Open Graph URLs use the runtime origin.
- JSON-LD uses `absoluteUrl()` from the validated environment.

**Why.** The image is built without an environment (ADR-016).

**Also decided:** `htmlLimitedBots` is Next.js's default crawler list plus `Googlebot`.

**Why.** By default Next.js streams metadata to Googlebot, and a rendered page then has `rel=canonical` and the meta description in `<body>`, where Google ignores the canonical. Crawlers on the list get blocking metadata in `<head>`; shoppers keep streaming. Lighthouse 12's mobile user agent matches neither list, so its `meta-description` audit reports the streamed tag as missing; that is expected.

### Route handlers

**Decision.** Any GET handler whose answer depends on the environment or the database calls `await connection()` first.

**Why.** Under Cache Components a GET handler with no request-time API is prerendered at build. The test-OTP endpoint's 404 was cached this way until this rule was applied.

### Test-only OTP endpoint

**Decision.** `/api/test/otp` exists only when `APP_ENV=test` and `SMS_PROVIDER=fake`.

**Why.** End-to-end tests sign in through the real OTP flow. Production cannot run the fake provider.

### Performance budget

**Decision.**
- Product cards use a lean `<img>` limited to the 320, 640 and 960 renditions (`components/product/card-image.tsx`) instead of `next/image`.
- Home-page rails leave out the hover image.
- The first homepage section streams in its own Suspense boundary.
- `next/image` widths match the five stored renditions.
- The announcement bar has a fixed height (with a same-size placeholder), and skeletons are at least one screen tall.

**Why.**
- Lighthouse showed LCP was mostly render delay: about 32 cards produced roughly 100 KB of HTML plus the same again in the RSC payload, and all of it was parsed before the content was revealed.
- A short skeleton let the footer paint and then jump away when content arrived (CLS 0.92 on fast loads).
- After these changes, home, listing and product page score 91–92 on mobile with CLS 0.

## Consequences

- The first request after a deploy fills each cache entry; the deploy smoke test should warm the home page, a listing and a product page (ADR-016).
- With Cache Components, an early click before hydration is replayed by React. Interactive tests wait for `networkidle` before opening drawers.
- `products:list` is revalidated on every stock change, so listing caches rebuild often when orders flow (Phase 3). If this becomes costly, only invalidate when `in_stock` flips.
- Checkout is shown but disabled until Phase 3.
- Turnstile is not wired into the sign-in forms yet (doc/06 listed it for Phase 2). Better Auth's captcha plugin covers it, and it moves to Phase 7 hardening along with a review of the `SearchProvider` split.

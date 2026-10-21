# 09 — Testing Strategy

## 1. Layers and tools

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Static | TypeScript strict, ESLint (with boundary rules), Prettier | Whole repository | Pre-commit (lint-staged) and CI |
| Unit | Vitest | Pure logic: pricing engine, discount rules, tax and slab calculation, pro-rata allocation, shipping fee, COD eligibility, state machines, Zod schemas, CMS block schemas and reference extraction, money and format utilities | CI, on every push |
| Integration | Vitest + **real PostgreSQL 18** (Docker) | Services, transactions, constraints, concurrency, RBAC, webhooks, jobs (pg-boss against the same database), with fake providers | CI, on every push |
| Races | Vitest, `tests/integration/races/` (ADR-0032) | Competing requests started together on separate connections: stock, payments, coupons, wallet, accounts, admin. Each scenario runs 3 times, then whole-database invariants are checked in SQL (`src/server/db/invariants.ts`) | CI, on every push |
| Races, production stack | Playwright, `tests/race/` (`npm run test:race`) | Signed-in customers in separate browsers press "Place order & pay" together, through Nginx and both app copies; fixtures from `dist/race-fixtures.mjs` | Against a local production stack (runbook: local-stack), and on staging before launch |
| Contract | Vitest + recorded fixtures | Razorpay signature and webhook verification against official test vectors. Shiprocket client request/response mapping from saved payloads. WhatsApp and SMS payload shapes. | CI |
| End-to-end | Playwright (Chromium + mobile WebKit viewport) | Customer, admin and CMS journeys on a running app with seeded data and fake providers | CI, on PRs to `main` |
| Accessibility | `@axe-core/playwright` | Every page template. No serious or critical violations. | CI (inside E2E) |
| Performance | Lighthouse CI | Home, listing, PDP, cart: mobile budgets (performance ≥ 90, LCP < 2.5 s, CLS < 0.1) | CI on PRs (warning), required before launch |
| Load | k6 | Browse, search, checkout-initiation burst | Phase 8 and before big sales |
| Container | Compose smoke tests | Image builds, stack starts healthy, migrations run, restart keeps data | CI (build plus smoke), Phase 7 on the VPS |
| Recovery | `restore-drill.sh` | Backup → restore → integrity checks | Monthly, and before launch |

## 2. Test data and isolation

- **Factories** in `tests/fixtures` build valid domain objects. The deterministic seed shares them.
- **Isolation:** each integration test file runs in its own database, cloned from a migrated template with `CREATE DATABASE … TEMPLATE`. That is fast and allows parallel workers. Concurrency tests use real separate connections, never a shared transaction.
- **Fake providers** (`PaymentGateway`, `ShippingProvider`, `MessageChannel`) can be scripted. Tests can make them fail, time out, send duplicates or reorder events.
- E2E payment uses the fake gateway with a **test-only** "simulate payment result" endpoint. It is compiled in only when `APP_ENV=test` and is unreachable in production builds; a test asserts that. Real Razorpay test-mode checkout is verified **manually** and in a nightly optional job, because automating Razorpay's hosted checkout UI is brittle.

## 3. Critical scenarios (must pass before launch)

| # | Scenario | Layer | Expected result |
|---|---|---|---|
| 1 | 20 concurrent checkouts for a SKU with `on_hand = 1` | Integration | Exactly 1 reservation succeeds, 19 get `OUT_OF_STOCK`, and the constraints hold |
| 2 | Razorpay payment fails, then the customer retries | Integration + E2E | Order stays `pending_payment`, the second payment confirms it, no duplicate order |
| 3 | Duplicate `payment.captured` webhooks, plus the callback, arriving in any order | Integration | One confirmation, one stock commit, one email job |
| 4 | Webhook with a bad signature | Integration | 401. Not processed. Logged. |
| 5 | Payment captured after the reservation expired: stock still available, and stock gone | Integration | Re-reserved and confirmed / automatic refund and cancellation, with alerts |
| 6 | Cart with an automatic discount, a coupon, wallet and partial COD | Unit + integration | Totals, allocation, tax lines, advance and COD due all match hand-calculated fixtures to the paisa |
| 7 | Coupon with `usage_limit_total = 1` redeemed by 5 concurrent orders | Integration | Exactly one redemption |
| 8 | Tampered client total or quantity | Integration | Ignored. The server quote wins. Invalid quantity rejected. |
| 9 | Customer cancels before dispatch (prepaid with wallet) | Integration + E2E | Stock restocked, Razorpay refund created idempotently, wallet credited, history written |
| 10 | Shipment status events arrive out of order or duplicated | Integration | Status never moves backwards. Events deduplicated. |
| 11 | Exchange to a more expensive variant, then QC passes | Integration + E2E | Difference paid, reverse and replacement shipments, stock movements correct |
| 12 | Partial-COD order delivered, then remittance imported | Integration | `payment_status` goes from `partially_paid` to `paid`. Amount reconciled. |
| 13 | CMS: editor drafts, manager publishes | E2E | Editor's publish is denied. The live page updates on both replicas within 10 s with no rebuild. |
| 14 | CMS scheduled publish | Integration | The worker publishes at the due minute exactly once, even with two workers running |
| 15 | Deleting a collection used by a published homepage block | Integration | Blocked with a "used by" list |
| 16 | Permission matrix: every protected action × every role | Integration | Only allowed roles succeed. Ownership is enforced for customers. |
| 17 | Back-in-stock: stock goes from 0 to above 0 | Integration | Subscribers notified once. Subscriptions marked as notified. |
| 18 | Analytics before consent | E2E | No GA4 or Meta requests until consent is granted |
| 19 | Container restart (`docker compose restart`, then a full `down` and `up`) | Container | Orders, media and sessions persist |
| 20 | Deploy during load | Container / load | No 5xx responses during a rolling restart |
| 21 | Backup → restore to a new host | Recovery | Row counts and the latest order match. Media checksums match. |

## 4. Real-provider verification (before go-live)

| Provider | How it is verified |
|---|---|
| Razorpay | Test mode: success, failure, UPI pending then captured, webhook delivery to the staging URL, full and partial refund. Then live mode: one real low-value order, refunded. |
| Shiprocket | No full sandbox. With the real account: serviceability for sample PIN codes (metro, tier-3, non-serviceable, COD on and off), create order → AWB → label → **cancel** before pickup, tracking webhook delivery check, and confirm with support how a partial-COD collectable amount is represented. |
| SMS (DLT) | OTP delivery on major carriers (Jio, Airtel, Vi, BSNL), template ID accepted, rate limits |
| WhatsApp | Each approved template renders with real data. Opt-out works. |
| Email | SPF, DKIM and DMARC pass (mail-tester score ≥ 9/10). Templates render in Gmail and Outlook. |
| Google OAuth | Production consent screen and redirect URIs on the final domain |

## 5. CI pipeline (`.github/workflows/ci.yml`)

```
install (npm ci, cached)
 ├─ lint + typecheck + format check
 ├─ unit tests
 ├─ integration tests (services: postgres:18)
 ├─ build (next build + worker/migrate bundles)
 │    └─ e2e (start app + postgres, seed, Playwright + axe) [PRs to main]
 └─ docker build + compose smoke test + Trivy scan + gitleaks
```

**Merge gates for `main`:** all jobs green and coverage at or above **90 %** for `features/pricing`, `discounts`, `inventory`, `payments`, `wallet` and `orders` service code. There is no global coverage target.

## 6. Environments

| Environment | Where | Data | Providers |
|---|---|---|---|
| Local | Developer Mac (Node 24 + `compose.dev.yaml`) | Demo seed | Fakes; Mailpit for email |
| CI | GitHub Actions | Fresh seed per run | Fakes |
| Staging (recommended) | Separate small VPS or a separate Compose project, behind Cloudflare Access | Demo seed + test orders | Razorpay **test** mode, real Shiprocket (with cancellations), real SMS/WhatsApp to test numbers |
| Production | Indian VPS | Real | Live |

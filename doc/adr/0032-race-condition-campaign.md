# ADR-0032: Race-condition test campaign

- Status: Accepted
- Date: 2026-10-21
- Deciders: On 2026-10-21 the owner asked for tests of what happens when several people act on the same thing at once (for example, 3 customers buying the last unit). They chose:
  - tests at both levels (integration and the production stack);
  - every area: stock, payments, money limits, accounts and admin;
  - to fix what the tests find.

## What is tested

**The rule every scenario checks:** whatever the timing, the result must be one that the same requests, sent one after another, could have produced.

**Integration level:** `tests/integration/races/`, 83 tests, run in CI.
- **How a race runs:** each scenario starts its competing calls together, on separate database connections, three times per run with fresh data.
- **What is checked afterwards:** the outcomes, plus whole-database invariants in SQL (`src/server/db/invariants.ts`):
  - stock matches its reservations and movements, and is never negative;
  - wallets match their ledgers;
  - coupon use matches redemptions and never exceeds its limit;
  - refunds never exceed a payment;
  - no money is kept on a cancelled or expired order;
  - no order is charged twice.
- **Proving the tests work:** removing the stock reservation's condition, or the payment row locks, makes the matching scenarios fail in every run.

**Production stack:** `npm run test:race`, `tests/race/`.
- **Setup:** customers sign in separately in their own browsers and press "Place order & pay" together, through Nginx and both app copies. `dist/race-fixtures.mjs` creates them, along with stock, coupons and wallet credit, through the app's own services. It refuses to run unless payments are fake.
- **Coverage:** 3 or 20 customers and 1 unit; a coupon's last use; wallet credit spent in two tabs; and a payment confirmed by the webhook and the browser at once.
- **Integration only:**
  - the same OTP twice (only the test environment exposes the code);
  - two staff saving a product (staff two-factor sign-in);
  - Pay pressed twice (there is no second payment path in the UI).

  The product case also has an end-to-end test of the form.

## Findings and fixes

### Checkouts using the same coupon deadlocked

**Found by:** M1–M3.

**What happened:** when several customers used a coupon at once, Postgres aborted the losers with a deadlock. They saw an error page instead of "this coupon has been fully used". The limit itself held.

**Cause:**
- `placeOrder` inserts the order's discount lines early in its transaction, and their foreign keys take KEY SHARE locks on the coupon and discount rows.
- `redeemCoupon` later locked the same rows `FOR UPDATE`, which conflicts with KEY SHARE.
- So two checkouts waited for each other.

**Fix:** `redeemCoupon` locks with `FOR NO KEY UPDATE`. That still lets only one redemption run at a time, but doesn't conflict with foreign-key checks. Losers now get the coupon message.

### A database lock conflict became an error page

**Decision:** `withTransaction` turns a deadlock or serialization failure (`40P01`, `40001`) into a `CONFLICT` with "Someone else changed this at the same moment. Please try again."

**Why not retry:** some transactions call outside services, which must not run twice.

**In the tests:** the race helpers report this message as `LOCK_CONFLICT`, so a deadlock can never pass as an expected outcome.

### A staff invitation accepted twice at once

**Found by:** A6.

**What happened:** the second request failed with a raw duplicate-key error, or a misleading "sign in first". One account was created, as it should be.

**Fix:** the invitation row stays locked for the whole acceptance, account creation included. The second attempt waits, then is told the invitation was already used.

### Two staff saving the same product: the later save silently won

**Found by:** A3 (expected from reading the code).

**Fix:**
- Products carry a version (`updated_at`). The admin form sends the version it loaded and keeps the new one after each save.
- A save based on an older version is refused: "Someone else saved this product after you opened it. Reload…".
- Every save now moves the version on, including category-only changes.

**Not fixed yet:** categories, collections, discounts and settings still save last-write-wins. The same pattern applies when they need it.

### Nginx sent the host without its port, which broke Server Actions

**Found by:** the HTTP suite's first run.

**What happened:** on any port other than 443, every Server Action failed with "Invalid Server Actions request", including add to bag, checkout and sign-in. Next.js checks that the browser's `Origin` matches the `Host`, and `proxy_set_header Host $host` drops the port.

**Fix:** `Host $http_host` (plus `X-Forwarded-Host`), the host exactly as the browser sent it.

**Why:** behind Cloudflare on 443 it would have matched, which is why the GET-only smoke and load tests passed. The fix makes the edge correct on any port.

### A used-up coupon at checkout said only "your total changed"

**Found by:** M1 through the stack.

**What happened:** when the coupon ran out between a customer's quote and their click, the recalculated total no longer matched and the order was refused. That's safe, but the message only said the total had changed.

**Fix:** the refusal now leads with the coupon's own reason ("This coupon has been fully used.") before asking the customer to review the new total.

### The fake payment gateway lived in one process's memory

**What happened:** a payment simulated on one web copy was unknown to the other copy and to the worker.

**Fix:** the fake gateway now keeps its records in `fake_gateway_records`.

**Why it matters:** the stack behaves like it does with Razorpay, and the HTTP race suite can test confirmations landing on different copies. Production never uses the fake (config/env.ts refuses it).

## Held without change

Each of these was raced and found correct:
- **Stock:** the last unit across many buyers, partial quantities, staff write-offs during checkout, and exchanges for the last replacement size.
- **Late payments:** a payment after the reservation expired is confirmed when stock remains, and refunded in full with an email when someone else bought the unit.
- **Payments:** duplicate and concurrent webhooks; a double Pay (one gateway order; a second capture is refunded automatically); cancelling while paying; cancelling while a parcel is booked; concurrent staff refunds; and background jobs racing payments.
- **Money:** wallet double spends, and coupon and credit releases on expiry.
- **Accounts and admin:** sign-ups with the same email, concurrent publishes of one CMS draft (published and audited once), concurrent stock adjustments, and back-in-stock emails (each sent once).

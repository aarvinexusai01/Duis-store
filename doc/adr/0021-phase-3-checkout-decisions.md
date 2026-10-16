# ADR-0021: Phase 3 checkout, payment and order decisions

- Status: Accepted
- Date: 2026-10-15
- Deciders: The owner answered the policy questions on 2026-10-15:
  - GST registered in Lucknow, Uttar Pradesh (`IN-UP`).
  - Razorpay test keys are available; courier APIs are not yet.
  - Only promotional wallet credit expires (after 30 days).
  - The remaining defaults in doc/10 are accepted.

## Context

Phase 3 moves money and stock. A bug here charges customers wrongly, oversells the last unit, or loses a payment. The plan (doc/03 §1–5) fixed the overall flow. Building it raised the decisions below, and each one is covered by an integration or end-to-end test.

## Decisions

### Pricing

**Decision.**
- Pricing is one pure function, `features/pricing/engine.ts`, with no I/O and no clock.
- The checkout service loads its inputs from the database: bag, address, settings, promotions, courier rate, COD eligibility and wallet.
- The client sends only its choices: address, payment mode, wallet on or off, coupon code.
- The order is placed only if the hash of the server's fresh quote matches the hash of the quote the customer saw.

**Why.** "Tampered client totals are ignored" holds by construction, since no total ever comes from the browser. The hash stops a silently changed price from being charged.

### Rounding

**Decision.**
- Percentage discounts round down.
- Pro-rata coupon shares give the remainder to the largest line.
- GST is computed as taxable = gross ÷ (1 + rate), rounded, with tax = gross − taxable. CGST is half of that, rounded down, and SGST is the rest.

**Why.** Every line's taxable value plus its tax equals the line total, and database CHECKs enforce it. The customer is never charged a fraction more than shown.

### GST slab

**Decision.**
- `tax_rules` has HSN chapters 61 and 62: 5% while the value per piece before tax is at most ₹2,500, otherwise 18% (from 2025-09-22).
- The slab is decided on net price ÷ 1.05.
- Shipping and COD fees are taxed at the order's highest line rate, as the principal supply.
- Exports are zero-rated under LUT.

**Why.** This is the current apparel rule as we understand it. The CA must still confirm the slab and fee interpretation (doc/10 A14). Rates are data, so a correction is a data change, not a deploy.

### Order placement

**Decision.**
- Placement is one transaction: order, items, discounts, stock reservation, wallet debit and coupon redemption.
- The client sends an idempotency key per attempt. A double click or a retried request returns the same order.

**Why.** All-or-nothing, as doc/03 §3 requires. A failed reservation or exhausted coupon rolls everything back.

### Coupon limits

**Decision.**
- Coupons are validated for the customer while quoting.
- When the order is placed, usage limits are checked again under a `FOR UPDATE` lock on the coupon row.
- Reversal (order expired or cancelled) gives the use back.

**Why.** The usage-limit test (three concurrent buyers, limit 1) passes: exactly one order is placed.

### Wallet

**Decision.**
- `wallet_ledger` is append-only, and every entry has an idempotency key.
- Credits become lots in `wallet_credit_lots`. Debits spend the soonest-expiring lot first and record which lots they used.
- Each debit has exactly one reversal key (`<debit key>:reversal`). The money goes back to the lots it came from, so promotional credit keeps its original expiry.
- A daily job expires promotional lots. Refunds have no expiry.

**Why.**
- The owner's rule: promotional credit expires after 30 days; refunded money never does, since expiring a customer's own money risks consumer-protection rules.
- A single reversal key prevents double credits when an order expires, is paid late and is then cancelled.

### Payment confirmation

**Decision.** One function, `settleCapturedPayment`, is called by all three paths: the browser callback, the webhook and the reconciler. It:
- locks the payment row;
- checks the amount and currency against our record;
- then handles every order state:
  - pending: confirm;
  - already confirmed with this payment: no-op;
  - a second payment for the same order: refund it;
  - expired or cancelled: try to take stock, wallet and coupon again, otherwise refund in full.

**Why.** "Whichever arrives second does nothing" (doc/03 §3). Duplicate, out-of-order and late events are covered by tests.

### Expiry

**Decision.**
- `inventory.expire-reservations` no longer touches order-held reservations.
- `orders.expire-pending` handles them: it asks the gateway first and, only if no payment is found, releases stock, wallet and coupon.
- If the gateway can't be reached, expiry waits for the next run.

**Why.** A paid order is never expired because a webhook was slow.

### Refunds

**Decision.**
- A refund row is written in the business transaction with an idempotency key, and the `payments.refund` job sends it.
- Before calling Razorpay, the job lists the payment's existing refunds and looks for its own receipt.

**Why.** A crash between the gateway call and the database update can't refund twice. The total refunded never exceeds the amount captured; this is checked under a lock and by a CHECK.

### Gateway

**Decision.**
- Razorpay is called over its REST API with `fetch` (no SDK).
- Webhooks are verified on the raw body, deduplicated by `x-razorpay-event-id` in `webhook_events`, and processed by a job.
- `PAYMENT_PROVIDER=fake` simulates the gateway for development and tests; production requires `razorpay`.

**Why.**
- Fewer dependencies, and the calls we need are small.
- The fake makes CI and end-to-end tests deterministic without network or keys.

### Payment UI

**Decision.**
- The browser opens Razorpay Checkout.js only after the order is placed and stock is held.
- If the payment fails or the customer closes it, the order stays pending until the hold ends (15 minutes), and "Pay now" on the order page retries on the same gateway order.

**Why.** The customer's bag is never charged twice, and a retry needs no new reservation.

### Queues

**Decision.** The web process's job sender creates any missing queue when it starts (idempotent).

**Why.** After a deploy, or in CI where no worker runs, the web app could otherwise enqueue (for example, a refund) before the worker has created the new queue, and pg-boss refuses that. The end-to-end cancellation test caught this.

### Country names

**Decision.** Country names come from a fixed English table in `lib/countries.ts` instead of `Intl.DisplayNames`.

**Why.** Node and Chromium ship different ICU names (Hong Kong, Macao, Palestine, Falkland Islands). That made server and browser HTML disagree, React re-rendered the form, and clicks were lost.

### Phone layouts

**Decision.** Two-column grids use `grid-cols-[minmax(0,1fr)]` on phones.

**Why.** The scrolling account tab bar had widened its grid column past the screen, pushing the "Cancel order" button out of reach on phones. The mobile end-to-end test caught this.

## Consequences

- The real-keys exit check needs the owner's Razorpay test keys in `.env`. Webhooks need a public URL (a tunnel, or staging); without one, the browser callback and the reconciler still confirm orders.
- The courier rates are the fake provider's demo card until Shiprocket and Shiprocket X are connected (Phase 4). The fake is refused in production.
- A staff screen for discounts, refunds and goodwill credit comes with the admin portal (Phase 4). Phase 3 has the services and the permission checks.

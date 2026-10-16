# ADR-0023: Phase 4b orders, shipping, customers and discounts decisions

- Status: Accepted
- Date: 2026-10-16
- Deciders: On 2026-10-16 the owner chose:
  - **One parcel per order.**
  - **Staff refunds** can be partial or full, to the original payment or the wallet, with a reason.
  - **Staff can cancel after an AWB**, before pickup; the courier cancellation must succeed first.
  - **COD remittances** come in through a generic CSV import.
  - Earlier, for Phase 4 as a whole: a fake courier plus a real Shiprocket client that stays unverified until a real test shipment.

## Context

Slice 4b lets the business run orders from `/admin`: book parcels, follow them, cancel and refund, reconcile cash on delivery, and manage customers and discounts. There is no Shiprocket account yet (doc/10 A5), so everything must work, and be tested, against a fake courier, without inventing data for real customers.

## Decisions

### Courier boundary

**Decision.**
- `ShippingProvider` now covers booking:
  - create order;
  - assign AWB;
  - label;
  - pickup;
  - cancel;
  - tracking.
- **The fake provider:**
  - gives deterministic AWBs (`FK…`);
  - draws a "DEMO LABEL" PDF with a small built-in writer (`lib/pdf.ts`, no dependency);
  - can be told to fail a step in tests.
- **The Shiprocket client:**
  - is written from Shiprocket's public API documentation and marked **unverified**;
  - caches its token in `provider_tokens`;
  - refuses international (Shiprocket X) bookings, and reports international rates as unavailable, until that API is checked.
- `SHIPPING_PROVIDER=shiprocket` needs the account email and password, the webhook token, and the pickup nickname and PIN code. `fake` is refused in production.

**Why.**
- Development and CI need no courier account.
- Production can't run on invented rates or dates.
- The unverified parts are named in the code and in doc/10.

### Resumable booking

**Decision.**
- Booking saves each courier answer as soon as it arrives: the courier order, the AWB, then the label file, then the pickup.
- A retry skips the finished steps.
- A short lease on the parcel row stops the inline attempt and a background retry from running together.
- Staff booking runs inline for up to five orders (so the page shows the result); larger bulk bookings, and any failure, go to the `shipping.create-shipment` job.

**Why.**
- A failure after the AWB never books a second courier order. The integration test fails the label step, retries, and checks the AWB and courier order are unchanged.
- End-to-end tests run without a worker, so the common path can't depend on one.

### Tracking

**Decision.**
- Courier words map onto our parcel states through a table (`features/shipping/status.ts`).
- Events are deduplicated on parcel, courier status and time.
- A parcel only moves forward:
  - between "out for delivery" and "delivery failed", the newer event wins;
  - a return never goes back to the delivery path;
  - finished parcels never change.
- Unmapped words are stored and logged, never applied.
- Three sources feed the same function:
  - the webhook at `/api/webhooks/logistics` (shared token, stored once, processed by a job);
  - a polling job for parcels with no update for six hours;
  - development-only "demo scans".

**Why.** doc/03 §6: out-of-order events never move a shipment backwards. Unit and integration tests cover duplicates, late events and the webhook path.

### Parcel → order

**Decision.**
- The orders module listens to parcel changes; the shipping module doesn't import orders.
- The order follows its parcel forward and never back:
  - processing → shipped → out for delivery → delivered;
  - or RTO initiated → RTO delivered.
- "Shipped" sends the customer an email with the courier and AWB.
- A returned parcel restocks the items and applies the RTO advance policy to partial-COD orders (default: keep the advance). Staff refund prepaid returns by hand; the order page asks them to.

**Why.** It keeps the modules acyclic, the same pattern as refunds. Prepaid returns need a judgement (shipping is usually kept), so they aren't automated.

### Cancellation

**Decision.**
- Customer and staff cancellation share one function.
- A customer can't cancel once a parcel exists. Before this slice, an order stayed "unfulfilled" until pickup, so the customer button would have stayed available after an AWB.
- Staff cancel the parcel with the courier first, and the order only if that succeeds.

**Why.** It is the owner's rule, and it prevents a cancelled order whose parcel still ships.

### Refunds

**Decision.**
- The refundable amount is everything collected (online, wallet and COD cash) minus what was already refunded or returned to the wallet.
- The refund can go to the original payment (split across payments, each through the existing idempotent refund job) or to the wallet as an `order_refund` credit that never expires.
- A reason is required.
- Each dialog has its own idempotency key, so a repeated request is a no-op.

**Why.** Staff can't refund more than was paid, and refunded money never expires (doc/10 P12).

### COD remittance

**Decision.**
- Staff upload a CSV with a reference (AWB or order number), the amount, the UTR and the date; common column names are recognised.
- A row is recorded only if the order was delivered and the amount equals the cash due exactly. Every other row is listed back with its line number.
- One remittance per order; the same UTR again counts as "already recorded".
- Remittance rows and staff notes are append-only for the app role.

**Why.** It is the owner's choice. A partial or wrong amount needs a person to look at it, not an automatic match.

### Address edits

**Decision.** Staff can correct an address only before booking, within the same state, and to a serviceable PIN code.

**Why.** A different state changes CGST/SGST to IGST, which needs a new order.

### Money visibility

**Decision.** Order lists and details return amounts only to roles with `order: read_financials`. Packing staff see items, addresses and parcels.

**Why.** doc/permissions.md: fulfilment works without revenue figures.

### Discount codes

**Decision.**
- Coupons have an optional per-code usage limit, for bulk single-use codes.
- Codes use 8 characters from an alphabet without 0/O/1/I/L.
- A discount's total limit now counts all its codes. A customer's per-person limit also spans all of a discount's codes, so bulk codes can't be stacked by one person.

**Why.** Influencer and campaign codes are single-use, and the limits must hold across codes.

### Dates

**Decision.** Every date shown in the app is formatted in IST.

**Why.** The production container runs in UTC, so dates without a zone would show times 5½ hours off.

## Consequences

- The Shiprocket account (doc/10 A5) is needed for the real check: one test shipment, created and cancelled. Until then `SHIPPING_PROVIDER=fake`, which production refuses.
- To verify with Shiprocket:
  - the partial-COD collectable amount;
  - the webhook URL rules and status words;
  - the label URL host;
  - Shiprocket X.
- Exchanges (Phase 5) reuse parcels with `direction = reverse/replacement`.

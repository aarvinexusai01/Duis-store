# ADR-0025: Phase 5a exchanges, tracking and reviews decisions

- Status: Accepted
- Date: 2026-10-16
- Deciders: On 2026-10-16 the owner chose to:
  - deliver Phase 5 in three slices;
  - use MSG91 for SMS and WhatsApp (slice 5b);
  - use GA4, Meta Pixel and the Conversions API (slice 5c);
  - send an item that fails QC back to the customer, with no replacement or credit.

  Exchange policy was settled earlier, in doc/10 P7–P10 and I5:
  - 10 days, innerwear excluded, 2 per item;
  - pay or credit the price difference;
  - free pickup;
  - international orders: damaged or wrong items only, handled by admins.

## Decisions

### Exchange lifecycle

**Decision.** An exchange is its own record (`exchange_requests`, numbered EX-100001…):
1. requested;
2. awaiting payment (only when the new option costs more), then approved;
3. pickup scheduled, picked up, received;
4. QC passed, replacement shipped, completed. Or: QC failed.

It can be rejected or cancelled only before a parcel exists. Only one exchange per order line can be open at a time.

**Why.** The flow in doc/03 §7. Closing only before any parcel exists means a booked courier pickup is never left orphaned.

### Eligibility

**Decision.**
- The order must be delivered.
- The window counts from the latest delivered parcel (forward or replacement).
- Categories have a staff switch, "exchangeable"; innerwear is off.
- An item's limit counts exchanges that weren't rejected, cancelled or failed.
- Only the same product, in another size or colour, with stock. The same variant is allowed only for a damaged or wrong item.
- International orders are refused online.

**Why.** It's the owner's policy, enforced on the server. The customer page shows why an item can't be exchanged.

### Stock

**Decision.**
- The replacement is held from approval, with a long hold that the expiry job skips.
- It is committed as `exchange_out` when the replacement is booked.
- The returned item comes back as `exchange_in`, only after QC passes.
- A failed QC releases the hold.

**Why.** doc/03 §7. The integration test checks every movement and level.

### Price difference

**Decision.**
- The difference is the new price minus the price paid per unit, times the quantity.
- If it's positive, the customer pays after approval, through the same gateway and checkout callback.
- The payment row has `purpose = exchange_difference`. Settlement hands it to the exchanges module instead of confirming an order.
- A second payment, or a payment for an exchange that has closed, is refunded.
- If the difference is negative, it is credited to the wallet as `exchange_credit` (never expires), and only after QC passes.

**Why.** It's the owner's policy (doc/10 P9). One settlement path keeps the duplicate and late-payment protections from ADR-021.

### Parcels

**Decision.**
- A return pickup is a `reverse` parcel: collected from the customer, delivered to the default stock location.
- A replacement, or an item sent back after a failed QC, is a `replacement` parcel.
- Parcel events reach every listener (orders and exchanges). Orders ignore exchange parcels.
- Shiprocket return booking is written but unverified, like the rest of that client.

**Why.** One courier pipeline: retries, labels, tracking and demo scans all work for returns too.

### Listener loading

**Decision.** The shipping module loads the orders and exchanges modules before its first parcel notification. Settlement loads exchanges before handing over a difference payment.

**Why.** A Next.js route bundle might never import the module that registered a listener, which would silently skip it.

### Customer photos

**Decision.**
- Photos are re-encoded to WebP (which also drops metadata), kept in private storage, and limited to 20 per customer per day.
- A photo is served to its owner, to staff with exchange or review read access when it is attached to an exchange or review, and to everyone once its review is approved.

**Why.** Photos can show faces and homes. Nothing becomes public until a person approves it.

### Tracking links

**Decision.** `/track/{order}?t=…`, where the token is an HMAC of the order number. The page shows parcel progress and the city only. The "shipped" email links to it.

**Why.** Customers can track from an email without signing in, and the link can't be guessed for other orders.

### Reviews

**Decision.**
- One review per delivered order line, from the buyer only.
- Every review is moderated (doc/10 P14).
- The display name is "First L.", never an email.
- Approved reviews update `products.rating_count` and `rating_average` (× 100), revalidate the product's pages, and add `AggregateRating` to the product's structured data.
- A review request goes out 5 days after delivery, once per order.

**Why.** Verified, moderated reviews, and search data built only from reviews a person approved.

## Consequences

- With the Shiprocket account, verify the return-booking fields and status words (doc/10 A5, question 5).
- Admins handle damaged or wrong items on international orders by hand (refund or wallet), as before.
- Next is slice 5b: MSG91 WhatsApp and SMS OTP with abuse limits, back-in-stock and abandoned-cart reminders.

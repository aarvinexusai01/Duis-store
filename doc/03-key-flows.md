# 03 — Key Flows & State Machines

These flows decide whether money and stock stay correct, so they are designed before any code. Each flow lists the database guarantees it relies on.

## 1. Pricing engine (server-only)

`pricing.quote(cart, customer, address, paymentMode, walletAmount, couponCode)` is a **pure function** over data loaded from the database. Its result is saved on the order. Steps:

1. **Line prices.** For each line: variant `price_paise` × quantity. The MRP (`compare_at_price_paise`) is kept for display only.
2. **Automatic discounts.** Product, variant, category and collection promotions that are active now. The best eligible one is chosen per line, by priority and then by largest saving. These are line-level discounts.
3. **Coupon.** At most one. Validation checks: active window, minimum order value, total and per-customer usage limits, eligibility rules (for example, first order only or phone verified), the target scope, and whether it can combine with the line discounts already applied. Cart-level amounts are spread **pro rata** across eligible lines, and the rounding remainder goes to the largest line. This keeps per-line tax and exchange valuation exact.
4. **Shipping fee.**
   - India: zero if the discounted subtotal is at or above the free-shipping threshold (₹999, set in admin). Otherwise the **live Shiprocket rate** for the delivery PIN code and total parcel weight, cached per (PIN code, weight band, COD flag) for a short time. If no rate is available, the quote fails with "delivery not available"; it never falls back to a made-up number.
   - International: the live rate from the international courier for the destination country and weight. Fee rules are still open (doc/10 §1b).
5. **COD fee.** If partial COD is chosen and a COD fee is configured, it is added (shown as its own line before payment; no drip pricing).
6. **GST breakdown.** Prices already include GST. For each line, the per-piece net price selects the GST slab from `tax_rules` (HSN + price threshold + effective date). Then `taxable = net ÷ (1 + rate)`. The split is CGST + SGST when the warehouse state equals the delivery state, otherwise IGST. Shipping and COD fees are taxed using the configured rule. **⚠ Verify** the slab interpretation with your CA (whether the ₹2,500 threshold is measured before or after tax, and how discounts affect it).
7. **Wallet.** `min(walletBalance, requestedAmount, grandTotal − minimumOnlineAmount)`.
8. **Payment plan.**
   - *Prepaid:* online amount = total − wallet.
   - *Partial COD:* advance = configured amount (fixed or %, capped at the remaining total). Online amount = advance. COD due = total − wallet − advance.

The quote returns every line, total and plan, plus a `quoteHash`. **The client never sends totals.** It sends the cart ID, address ID, payment mode, wallet amount and coupon code, and the server recalculates the quote each time.

## 2. Inventory model

The `inventory_levels` table holds one row per (variant, location), with `on_hand` and `reserved`.
**Available = on_hand − reserved.** Constraints: `CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)`.

| Operation | SQL shape (single statement, no read-then-write) |
|---|---|
| Reserve | `UPDATE inventory_levels SET reserved = reserved + :q WHERE variant_id=:v AND location_id=:l AND on_hand - reserved >= :q RETURNING …`. If no row comes back, that line is out of stock. |
| Commit (order confirmed) | `reserved -= q, on_hand -= q`. Writes an `inventory_movements` row with reason `sale`. |
| Release (expired, failed or cancelled before commit) | `reserved -= q` |
| Restock (cancelled after commit, exchange item received after QC) | `on_hand += q` plus a movement row |
| Admin adjustment | `on_hand += delta`, which is rejected if the result would go below `reserved`. Movement row with reason and actor. |

- All lines in an order are reserved in **one transaction**, in **variant-ID order** so concurrent transactions can't deadlock. If any line fails, everything rolls back.
- Reservations are created **when payment starts** (when the Razorpay order is created), not when an item is added to the cart. TTL is 15 minutes, configurable.
- `inventory_reservations` rows record each reservation's status (`active → committed | released | expired`), and every status change is idempotent.
- The guarantee comes from the conditional UPDATE combined with the CHECK constraints. Two customers buying the last unit at the same time can't both succeed. An integration test with N parallel checkouts verifies this.

## 3. Checkout and payment: prepaid

```
Customer            web (service)                  Postgres                   Razorpay
   │ Place order        │                               │                          │
   ├───────────────────►│ quote() again; validate address, serviceability, COD rules
   │                    │ BEGIN                         │                          │
   │                    │  insert order(pending_payment), items, tax lines, discounts
   │                    │  reserve stock (conditional UPDATEs)                     │
   │                    │  debit wallet (ledger, idempotency key = order id)       │
   │                    │  redeem coupon (row lock + usage check)                  │
   │                    │ COMMIT                        │                          │
   │                    │ create Razorpay order (receipt = order number, notes.order_id)
   │                    ├──────────────────────────────────────────────────────────►
   │                    │ save payments row (razorpay_order_id, amount, status=created)
   │◄───────────────────┤ return checkout options (key_id, rzp order id, amount)   │
   │ Razorpay Checkout (UPI/cards/netbanking/wallets) ─────────────────────────────►
   │ handler(payment_id, order_id, signature)                                      │
   ├───────────────────►│ verify HMAC(order_id|payment_id, key_secret), timing-safe
   │                    │ fetch payment from Razorpay; check amount, currency, status
   │                    │ confirmOrder(orderId) ── idempotent ──► commit reservation,
   │                    │   order → confirmed, payment → captured, history rows,
   │                    │   enqueue orders.post-confirmation                       │
   │◄───────────────────┤ redirect to /checkout/success/{orderNumber}              │
                         ▲
   Razorpay webhook ─────┘ (payment.captured / order.paid / payment.failed) → same confirmOrder()
```

- **Two paths, one outcome.** The browser callback and the webhook both call the same idempotent `confirmOrder()`. Whichever arrives second does nothing. The webhook makes confirmation work even if the customer closes the tab.
- **Never trust the client alone.** The signature is verified **and** the payment is fetched from the server side. The amount and currency must match the `payments` row.
- **Payment failure.** `payment.failed` marks that attempt as failed. The order stays `pending_payment`, so the customer can retry with a new Razorpay order and the same reservation, until the TTL runs out.
- **Expiry.** `inventory.expire-reservations` changes the order to `expired`, releases stock, reverses the wallet debit and coupon redemption, and writes history. A `payments.reconcile` call to Razorpay runs first, so an order paid but not yet reported isn't expired by mistake.
- **Late payment** (captured after expiry):
  1. If stock is still available, re-reserve and confirm.
  2. Otherwise, refund automatically (idempotency key `late-refund:{payment_id}`), set the order to `cancelled` with reason `stock_unavailable_after_payment`, and notify the customer and the admins.
- **Capture mode.** Auto-capture is enabled on the Razorpay account. **⚠ Verify** the current capture settings in the Razorpay dashboard and API.

## 4. Partial COD

This flow is the same as prepaid, with these differences:

1. **Eligibility check**, run while quoting:
   - The delivery address is in India. International orders are prepaid only.
   - Shiprocket serviceability returns `cod = true` for the PIN code (cached per PIN code for 24 hours).
   - The order total is at or below the partial-COD cap (₹2,500). The advance is ₹100 and the COD fee ₹5.
   - The customer's phone is verified.
   - The customer and PIN code are not on the COD blocklist.
   - If any check fails, only Prepaid is offered, with a clear reason.
2. **Razorpay order for the advance only.** The `payments` row has `purpose = advance`.
3. **On confirmation:** `payment_status = partially_paid`, `amount_cod_due_paise` is stored, and the order shows "Pay ₹X in cash on delivery".
4. **Shipment creation** sends Shiprocket `payment_method = COD` with the **collectable amount equal to the COD balance only**. **⚠ Verify** the exact fields with Shiprocket support before building. Public sources describe the workaround of sending only the pending amount, but no official field for an advance payment.
5. **Delivered:** the order is marked `cod_collection_pending`. `cod.reconcile-remittance` matches Shiprocket remittance data (API or CSV import) and moves the payment to `paid`.
6. **RTO or refused delivery:** stock is restocked when the parcel returns. What happens to the advance (refund to source, credit to the wallet, or keep it as a fee) is a **policy setting**; see the open questions.

## 5. Order lifecycle

```
pending_payment ──► confirmed ──► processing ──► shipped ──► out_for_delivery ──► delivered
      │                 │              │            │                                │
      ▼                 ▼              ▼            ▼                                ▼
   expired          cancelled      cancelled     rto_initiated ──► rto_delivered   (exchange
 (stock released)  (restock +     (restock +     (restock on                       requests
                    refund/wallet) cancel AWB)    receipt)                          per item)
```

- **Customer cancellation** is allowed while the status is `confirmed` or `processing` and no AWB has been generated. That covers the window before dispatch.
- **Cancellation refunds** go to the original source: Razorpay refund for the online amount and a wallet credit for any wallet part. Only collected amounts are refunded, and no COD balance has been collected at that point.
- **Separate status fields** are kept on the order: `status`, `payment_status` (`unpaid | partially_paid | paid | partially_refunded | refunded`) and `fulfillment_status` (`unfulfilled | fulfilled | partially_returned …`).

## 6. Shipping with Shiprocket

1. **Serviceability, PDP and checkout.** Pickup PIN code, delivery PIN code, weight and COD flag go in, and couriers, estimated delivery date and COD availability come out. Results are cached per PIN code. If the API fails, we show "Delivery estimate unavailable", never a made-up date.
2. **Shipment creation** (admin action → job):
   1. Create the Shiprocket order.
   2. Assign an AWB (using the recommended courier, or the admin's choice).
   3. Generate the label.
   4. Request pickup.
   Each step is saved, so a retry resumes where it stopped. The label PDF is copied to private storage.
3. **Tracking:**
   - A webhook at `/api/webhooks/logistics` checks a token header. The path deliberately avoids carrier brand words. **⚠ Verify** Shiprocket's URL rules in the panel.
   - Tracking events are deduplicated on (shipment, status code, time).
   - Shiprocket status codes are mapped to our normalised statuses through a mapping table.
   - A polling job is the fallback for active shipments that have had no update for six hours.
   - Out-of-order events never move a shipment's status backwards.
4. **API token.** Shiprocket's token is cached in the database and refreshed before it expires.
5. **Testing.** Shiprocket has no full sandbox, so development and CI use the `fake` provider. Real-account verification uses cancellable test shipments; see [09-testing-strategy.md](09-testing-strategy.md).

## 7. Exchange (self-service)

```
requested ──► approved ──► reverse_pickup_scheduled ──► picked_up ──► received ──► qc_passed ──► replacement_shipped ──► completed
    │            │                                                        │
    ▼            ▼                                                        ▼
 cancelled    rejected                                                qc_failed (item returned to customer / closed per policy)
```

- **Eligibility:**
  - The item was delivered within the exchange window.
  - The category allows exchanges.
  - The per-item exchange limit hasn't been reached.
  - The replacement is the same product in another size or colour, with stock available.
- **Replacement stock** is reserved when the exchange is approved, and committed when the replacement ships.
- **Price difference.** If the replacement costs more, the customer pays the difference through Razorpay (`purpose = exchange_difference`). If it costs less, the difference is credited to the wallet. This needs policy confirmation.
- **Reverse pickup** is created through `ShippingProvider.createReversePickup`. The returned item is restocked only after it passes QC.
- **Damaged or wrong item:** admins resolve it with a refund (Razorpay, or wallet for the COD part) or a free replacement. These are audited.

## 8. Wallet (store credit)

- **Append-only ledger.** `wallet_ledger` has signed amounts with unique `idempotency_key`. `wallet_accounts.balance_paise` is a cached balance, updated in the same transaction under a `SELECT … FOR UPDATE` lock, with `CHECK (balance_paise >= 0)`.
- **Credits** come from cancellation refunds of wallet-paid amounts, exchange price differences, admin goodwill (needs a permission and a reason, and is audited) and RTO advance credits (if that is the chosen policy).
- **Debits** come only from checkout, and are reversed automatically on expiry or cancellation.
- **No withdrawal or transfer.** This keeps it a closed-loop store credit. Expiry is an optional policy.

## 9. Webhook handling pattern (Razorpay and Shiprocket)

1. Read the **raw body** and verify the signature or token (Razorpay: HMAC SHA256 of the raw body with the webhook secret, compared in constant time).
2. `INSERT INTO webhook_events (provider, event_id, …) ON CONFLICT DO NOTHING`. The event ID comes from the provider (Razorpay's `x-razorpay-event-id`). If the row already existed, return 200 and stop.
3. Queue a processing job and **return 200 quickly**.
4. The job applies the event through the domain state machine. Duplicate or stale events make no changes. Failures retry with backoff and finally land in a dead-letter queue that admins can see.

## 10. CMS publishing

```
draft ──► in_review ──► approved ──► scheduled ──► published ──► archived
  ▲          │             │            │
  └──────────┴── changes requested ─────┘        rollback = copy an old revision into a new draft
```

- **Content Editors** can create and edit drafts and submit them for review. **Content Managers** can approve, publish, schedule, unpublish, archive and roll back.
- **Saving a revision** validates every block against its Zod schema and rewrites that revision's reference rows (products, collections, categories, media), which are foreign-key constrained.
- **Preview:** Next.js `draftMode()` with a short-lived signed token. Preview renders the chosen revision with the real storefront components.
- **Publishing:** set `published_revision_id` in a transaction, write the audit log, queue `cache.revalidate` for the page's tags. The page is live within seconds.
- **Scheduling:** `cms.publish-scheduled` runs every minute. It picks up due revisions with `FOR UPDATE SKIP LOCKED` and publishes them idempotently. No browser timers are involved.
- **Hidden references:** if a referenced product or collection is later archived or unpublished, the block renders without it, and the CMS dashboard shows a "broken reference" warning.

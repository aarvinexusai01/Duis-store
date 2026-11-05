# ADR-0034: US-dollar prices outside India

- Status: Accepted (owner decisions, 2026-11-05). Partly supersedes ADR-0018 §1 (one currency) and §4 (live international rates only).
- Date: 2026-11-05

## Context

ADR-0018 kept one price list in INR: international customers paid rupees and their bank converted. The owner wants customers outside India to see and pay US dollars, at the day's exchange rate plus a per-country increase.

## Decision

1. **Who pays in dollars.** Everyone delivering outside India, once `store_settings.usd_pricing_enabled` is on. The delivery country at checkout decides; the visitor's country (Cloudflare) and a header switch only decide what's shown while browsing. India stays INR.
2. **The price.**
   - Formula: rupee price ÷ rate × (1 + country increase), rounded **up** to the next .99 (`src/lib/fx.ts`). The arithmetic is BigInt in integer units.
   - The increase applies to product prices only.
   - Shipping is a flat USD fee per country (`country_pricing`). There's no free shipping abroad.
   - The owner books export parcels by hand until an international courier is connected.
3. **The rate.**
   - Source: the ECB's daily reference rate, fetched at 21:15 IST (`pricing.refresh-fx`), with Frankfurter as a fallback. Rows are kept in `fx_rates`.
   - Refused rates: below ₹50 or above ₹200 per dollar, or a move of more than 5% in a day. The last good rate stays in force, and the ops check warns after 4 days.
   - Staff can lock a rate instead.
4. **The books stay in rupees.**
   - On a USD order, the existing `*_paise` columns hold the INR equivalent at the order's saved rate. So every CHECK, the GST CSV, the dashboard and the wallet code are unchanged.
   - The charged amounts go in `*_minor` (cents). The rate, its source and date, and the increase are snapshotted on the order (`orders_minor_check` enforces this).
   - `payments.amount_paise`, `refunded_paise` and `refunds.amount_paise` are in minor units of their row's `currency`. The column names stay, because renaming needs an expand/contract migration.
5. **What USD orders can't use:**
   - wallet credit, which is in INR;
   - fixed-amount coupons (percentage ones still apply);
   - COD, which ADR-0018 already limits to India.
6. **Search engines and caches.**
   - Crawlers always get INR pages and INR structured data. Googlebot crawls from the US, and Google requires the visible price to match the structured data.
   - Nginx serves cached pages only to visitors certain to see INR.
7. **Off until it's ready.** The switch stays off until checkout, after-sale and storefront support have shipped and Razorpay has enabled USD (a preflight checks this).

## Consequences

- Razorpay settles USD payments in INR at its own rate, so the settled amount can differ from the INR equivalent stored on the order.
- The CA must confirm which rate export invoices use (CBIC's notified customs rate or the RBI reference rate). The export CSV carries the foreign value and rate, so the invoicing tool can recompute.
- Exports still need an IEC and an LUT (ADR-0018).

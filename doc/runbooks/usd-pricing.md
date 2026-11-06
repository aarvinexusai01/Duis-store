# US-dollar pricing

How to switch on dollar prices for visitors outside India, check that they
work, and what to do when the exchange rate alert fires (doc/06 Phase 13,
ADR-0034). Everything here is done in the admin unless a step says
otherwise.

Dollar checkout is **off** until someone switches it on. While it is off,
everyone sees and pays rupees, and international addresses can't check out.

## Before switching on

All of these must be true. The switch itself checks the first three.

1. **A rate exists.** Go to Settings → International pricing (USD). "Rate in use"
   shows a rate from the European Central Bank. If it says none, press
   **Fetch now**.
2. **At least one country ships and has a fee.**
   - Settings → Shipping: tick the countries you will ship to.
   - Settings → Countries: increase and shipping: give each one a US$
     shipping fee and, if it differs from the default, its own increase %.
3. **Razorpay accepts US dollars.** Ask Razorpay support to enable
   international cards and USD on the live account. The switch places a $1
   test order with Razorpay and refuses with "Razorpay hasn't enabled US
   dollars on this account yet" until they do.
4. **Exports are allowed.** Settings → Store & legal has the IEC and the
   LUT reference (ADR-0018).
5. **The CA has said which rate export invoices use** (CBIC's notified
   customs rate or the RBI reference rate). The GST CSV carries the foreign
   value and the rate used, so invoices can be recomputed either way.

## Switching on

1. Settings → International pricing (USD) → **Switch on**, and confirm.
2. Check the shop from outside India. A VPN to the US is enough: Cloudflare
   sends the visitor's country to the app.
   - Product cards, the product page, the bag and search show `$…99` prices.
   - The header has a **₹ INR / $ USD** switch (in the menu on phones).
   - Choosing ₹ INR shows rupees on every page until it is changed back.
3. Check from India, without the VPN: rupees, with the same switch.
4. **A small live order and refund:**
   - From the US (VPN), put the cheapest item in the bag and check out to a
     real address in a ticked country. The total is the dollar prices plus
     the country's flat fee, charged in US dollars.
   - In Admin → Orders, the order shows "Charged $… · ₹…" with the rate.
   - Cancel it and refund to the original payment. Razorpay returns the
     dollars. Confirm the refund in the Razorpay dashboard.

## Shipping an export order

International orders aren't sent to Shiprocket. Book the parcel with the
courier yourself, then on the order page:

1. **Enter parcel**: the courier's name and the AWB.
2. Move it on with **Mark picked up**, **Mark in transit**, **Mark out for
   delivery** and **Mark delivered**. The customer gets the usual shipped
   email.

## Switching off

Settings → International pricing (USD) → **Switch off**. Visitors see rupees
again within five minutes (their browser keeps its answer that long), and
international checkout is unavailable. Orders already placed keep their
currency, refunds and emails.

## "US dollar exchange rate" alert

The daily job (`pricing.refresh-fx`, 21:15 IST) fetches the ECB's rate,
falling back to Frankfurter. It refuses a rate below ₹50 or above ₹200 a
dollar, or a move of more than 5% in a day. The alert fires when the newest
rate is more than four days old. Prices keep using the last good rate.

1. Settings → International pricing (USD) → **Fetch now**. If it works, the alert
   clears on the next check.
2. If it fails with a sanity error (a real move of more than 5%, rare), set
   **A fixed rate I set**, enter today's rate in "₹ per US dollar", save,
   and switch back to the ECB rate the next day.
3. If both sources are unreachable, check the worker
   ([Incident: worker and jobs](incident.md#worker-and-jobs)) and the
   server's outbound network. A fixed rate keeps checkout working meanwhile.

## How it works

- **Pages are always rendered in rupees.** The Nginx page cache, Google and
  the structured data (`priceCurrency: INR`) see one version.
- **The browser converts.** Once a page is interactive it asks
  `/api/pricing`, which reads Cloudflare's `CF-IPCountry` header and
  returns the rate and the country's increase. Search engines and link
  previews always get rupees.
- **The visitor's choice** is the `duis_cur` cookie. A visitor who last saw
  dollars has prices hidden for a moment, never more than two seconds, so
  rupees don't flash first.
- **Checkout decides by the delivery country**, not by what was shown. An
  Indian address pays rupees; an address abroad pays dollars at the rate in
  force when the order is placed. A rate change during checkout asks the
  customer to review the new total.

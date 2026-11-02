# Appendix C. Requirements register

> Part of the [DUIS Printworks plan](README.md). § numbers refer to [development-plan.md](development-plan.md).

## C.1 Confirmed
| ID | Requirement |
|---|---|
| R1–R5 | Separate app "DUIS Printworks" in its own repository, with its own environment, database, auth and deployment; Duis-store code only inspected (this plan directory is the only addition); reuse by adapting files; plan only after discovery |
| R6 | Hybrid model: instant slab pricing plus in-app quotes; businesses save GSTIN and company details |
| R7 | Own factory; production board; blank stock tracked |
| R8 | Customisation v1 = upload + automatic mockup + designer's proof + in-app approval; live editor in v2 |
| R9 | Launch catalogue: Apparel; Gifts & merch |
| R10 | Instant orders: pay → proof → approve. Quotes: proof with the quote → accept → pay |
| R11 | Razorpay prepaid and partial COD; no full COD, no credit or PO, no recorded bank transfers |
| R12 | In-app GST invoices and credit notes; GSTIN at checkout or later |
| R13 | Individuals buy freely; business details on the buyer's own account; no teams |
| R14 | One fixed decoration method per product; priced print positions |
| R15 | Slabs counted per colour (or model) |
| R16 | Per-piece personalisation as a free-text note |
| R17 | Design free; unlimited revisions |
| R18 | Quote needed beyond the top slab, for quote-only products, special packaging, several addresses |
| R19 | Quote paid as an online advance, then the online balance before dispatch |
| R20 | Customer cancellation within 2 working hours; staff can still cancel and refund |
| R21 | Proof reminders, then staff follow-up; no auto-approve or auto-cancel; paid orders never expire |
| R22 | Claims by email or WhatsApp; staff record a reprint or a refund |
| R23 | Out-of-stock blanks blocked on the storefront |
| R24 | Generic dispatch statement; no per-product promise or estimated delivery date |
| R25 | Several addresses → one order per address |
| R26 | Sign-in required (OTP, email, Google); no guest checkout |
| R27 | Reorder, saved logos, production progress, wishlist |
| R28 | Email and WhatsApp; SMS only for login codes |
| R29 | India and international (prepaid, LUT, Shiprocket X) |
| R30 | Roles: Designer, Sales, Production Manager and Operator, Accounts, plus the Duis roles |
| R31 | Standard production pipeline |
| R32 | Automatic routing to stations by method; manager assigns operators |
| R33 | Production, quote and sales, design, and accounts reports |
| R34 | Own professional brand look |
| R35 | Same legal entity and GSTIN as Duis (UP); own invoice series |
| R36 | Own VPS |
| R37 | Lean infrastructure: 1 web container, no Redis or Elasticsearch |
| R38 | New repo, copy and adapt |
| R39 | Artwork in a private Cloudflare R2 bucket |
| R40 | Turnover below ₹5 cr; no e-invoicing for now |
| R41 | After launch: live editor, then names list, then company teams and credit |
| R42 | India shipping: free above a threshold set in admin, otherwise the live courier rate |
| R43 | No wallet; refunds to the original payment method |
| R44 | Artwork: PNG, JPG, WebP, SVG, PDF, AI; up to 50 MB; CDR, EPS and PSD refused |
| R45 | Launch extras: reviews, coupons and discounts, email marketing, blog |
| R46 | Kits and gift sets are products with a fixed list of items; one production job per item at its station plus a kit-assembly job; stock reserved per item; a size mix when a kit includes clothing |
| R47 | Uploading artwork needs a signed-in account (phone OTP, email or Google) |

## C.2 Assumptions (built as stated unless the owner, or for the tax ones the CA, changes them)
| ID | Assumption |
|---|---|
| A1 | "Per colour" means per non-size variant (model, shape, type) for products without colours |
| A2 | MOQ and step apply per colour or model group |
| A3 | Extra-position add-ons are a flat price per piece (no slabs) |
| A4 | Printed goods are a composite supply; add-ons are folded into the unit price for the GST rate (**CA**) |
| A5 | Partial-COD advance, cap and fee are admin settings |
| A6 | Quote validity 15 days by default; staff price overrides need a reason and are audited |
| A7 | Self-service cancellation is open until 2 working hours after payment, or until a designer claims the design, whichever comes first |
| A8 | Quote orders: cancellable within 2 working hours of paying the advance; afterwards the advance is non-refundable unless staff decide otherwise |
| A9 | Partial-COD advance refunded on cancellation inside the window; on RTO it follows the RTO setting |
| A10 | A reprint is a new production job plus a free replacement shipment, audited |
| A11 | Quote stock is reserved when the advance is paid; quotes aren't blocked by storefront stock |
| A12 | The quote holds the advance and balance payments; child orders carry `quote_id`; dispatch waits for the balance |
| A13 | Invoice per order, issued when its shipment is booked; advances on goods take no GST. If the CA requires receipt vouchers for advances, they are one more PDF template (**CA**) |
| A14 | INR only; international cards charged in INR |
| A15 | No wallet (since confirmed as R43) |
| A16 | The factory is in UP, under the same state GSTIN |
| A17 | A deploy causes a few seconds' interruption with one web container |
| A18 | Artwork rights confirmation is required on every upload |
| A19 | Slab counts combine every design of the same product and colour in the cart |
| A20 | GSTIN can be changed until the invoice is issued, then only by Accounts; place of supply for GSTIN buyers is the GSTIN's state (**CA**) |
| A21 | E-way bill above ₹50,000: generated by Accounts on the EWB portal, number recorded in the app and passed to Shiprocket (**CA** for the UP intra-state threshold; check Shiprocket's field) |
| A22 | An unchanged reorder carries the previous approval over and skips a new proof |
| A23 | Product and CMS images are served from the local media volume through Nginx and Cloudflare's edge cache; ImageKit and the zoom watermark (Duis Phase 10) aren't used at launch |
| A24 | Before production starts, staff can swap sizes within a design when the total quantity stays the same (price unchanged, stock moved, audited); any other change is a cancellation and a new order |
| A25 | A kit is a mixed supply, taxed at the rate of its highest-taxed item; the kit's HSN and tax rule are set to that item's (**CA**) |
| A26 | The quote request form works signed out (contact details, Turnstile, rate limits); a quote requested signed out is linked to the account that accepts it |

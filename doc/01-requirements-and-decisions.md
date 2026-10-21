# 01 — Requirements & Decisions

## 1. What we are building

A production-ready, self-hosted e-commerce platform for **Duis**, a single-merchant men's fashion brand selling online in India.

- **Catalogue at launch:** Oversized, regular, polo and graphic T-shirts, shirts, hoodies, sweatshirts, jeans, trousers, shorts and other menswear.
- **Future-proofing:** The data model supports a Women department and further departments without restructuring.
- **Three interfaces in one application:**
  1. **Storefront**: the public shopping site. This is the top priority.
  2. **Admin portal** (`/admin`): products, inventory, pricing, collections, orders, customers, discounts, shipping, exchanges, refunds, staff.
  3. **CMS portal** (`/admin/cms`): homepage, banners, featured collections, landing pages, blog, media, navigation, SEO, publishing.
- **Non-goals:** POS, multi-vendor marketplace, multiple currencies. International customers are served at launch, but they pay in INR (decision 22).

## 2. Business decisions (answered 2026-10-13)

| # | Topic | Decision | What it means for the build |
|---|---|---|---|
| 1 | CMS | **Custom CMS inside the app** | Built on the shared Drizzle schema with Tiptap (rich text) and dnd-kit (drag and drop). One login and role system. CMS blocks reference products, collections and media through real foreign keys. |
| 2 | Fulfilment | **Own stock, one warehouse** | Inventory is tracked per SKU per location, starting with one default location. Shiprocket picks up from one address. The schema still supports more locations later. |
| 3 | Payment modes | **Prepaid + partial COD** (India only) | Customers either pay in full through Razorpay, or pay a **₹100 advance** through Razorpay and the balance in cash to the courier. Partial COD applies to orders up to **₹2,500**, with a **₹5 COD fee**. Needs a payment plan per order, COD eligibility checks, an advance-only Razorpay charge, a COD-balance amount sent to Shiprocket, and COD remittance reconciliation. |
| 4 | Mobile apps | **Web only for now** | Mobile-first responsive site, PWA-friendly. Business logic stays in services that are independent of HTTP, so a REST API can be added later without a rewrite. |
| 5 | Sign-in | **Email + password, phone OTP (SMS), Google** | Better Auth with the email/password, phone-number (OTP) and Google providers. An SMS provider with Indian DLT registration is needed. |
| 6 | Guest checkout | **Not offered** | An account is required to check out (phone OTP keeps this fast). Carts work before login and merge into the account at login. |
| 7 | Post-purchase | **Self-service exchange only** | Customers request a size or colour exchange from their account. Reverse pickup and forward replacement go through Shiprocket. Refunds happen only for damaged or wrong items and are issued by admins. Customers can cancel before dispatch. |
| 8 | Notifications | **Email + WhatsApp** | A notification service with email (SMTP) and WhatsApp (BSP adapter) channels. SMS is used only for login OTPs. |
| 9 | Extra v1 scope | **Reviews and ratings, back-in-stock alerts, store credit wallet, abandoned-cart emails** | Four extra modules, each with admin controls. The wallet is a closed-loop ledger and also serves as a payment method at checkout. |
| 10 | GST invoices | **Issued by an external tool** (Zoho Books, Tally or Shiprocket) | The platform still calculates and saves GST per order line (HSN, rate, taxable value, CGST/SGST/IGST) and provides CSV exports. It does not number or print invoices. |
| 11 | Shipping fee | **Free at or above ₹999; below that, the live courier rate for the PIN code** | The threshold can be edited in admin. Below it, the customer pays the rate Shiprocket quotes for that PIN code and parcel weight, so product weights must be accurate. If no rate can be fetched, checkout says so; it never invents a rate. International shipping fees are open (doc/10 §1b). |
| 12 | Catalogue data | **None yet, so demo data** | A deterministic seed creates realistic demo products, variants, stock, collections and CMS content with generated placeholder images. CSV import is deferred. |
| 13 | Scale | **Medium**: 500–5,000 products, 100–1,000 orders a day | One server with two web replicas (no downtime during deploys, uses more CPU cores) and PostgreSQL full-text search. No Redis. Load tested before launch. |
| 14 | Server | **Cloud VPS in an Indian region** | Recommended size is about 8 vCPU, 16 GB RAM and 160 GB+ SSD, running Ubuntu LTS. |
| 15 | Edge | **Cloudflare proxy (free plan)** | Origin certificate with Full (strict) TLS. The server firewall only accepts connections from Cloudflare. Real client IPs come from `CF-Connecting-IP`, which Nginx trusts only from Cloudflare's IP ranges. Turnstile protects the OTP and auth forms. |
| 16 | Backups | **S3-compatible bucket** | Encrypted off-site backups. PostgreSQL gets point-in-time recovery (pgBackRest) plus a nightly logical dump. Media is backed up with restic. |
| 17 | Deploys | **Build on the server** | `scripts/deploy.sh` builds images tagged with the git commit (SHA), runs migrations, then updates the replicas one at a time. Rollback switches to the previous image without rebuilding. GitHub Actions still runs the checks on pull requests. |
| 18 | Brand | **"Duis"**; domain still to be decided | The brand name, logo and domain come from configuration and CMS site settings, never hard-coded. |
| 19 | Design | **Bold streetwear** | High contrast, graphic-led and energetic, in the spirit of The Souled Store and Bewakoof without copying their designs, branding or imagery. |
| 20 | Tracking and monitoring | **GA4, Meta Pixel and Conversions API; lean monitoring plus error tracking** | A consent banner is required, plus Google Consent Mode, server-side Meta events with deduplication, structured logs, health checks, external uptime checks, and Sentry-compatible error tracking. |

### Follow-up decisions (after plan review, 2026-10-13)

| # | Topic | Decision | What it means for the build |
|---|---|---|---|
| 21 | Policy values | Answered in [10 §1](10-open-questions.md#1-policy-questions-needed-before-the-phase-shown) | Stored as admin settings: partial-COD advance ₹100 and cap ₹2,500, COD fee ₹5, advance kept on RTO, reservation hold 15 minutes, exchange window 10 days (innerwear excluded), up to 2 exchanges per item, free reverse pickup. Wallet: promotional credit expires after 30 days, refunds never expire (changed 2026-10-15). |
| 22 | Currency and markets | **INR everywhere; worldwide shipping at launch** | One INR price list. International customers pay by international card through Razorpay. International orders are prepaid only. Addresses, shipping and tax become country-aware from Phase 1 ([ADR-018](adr/0018-worldwide-shipping-inr-only.md)). |
| 23 | Staff roles | **Seven roles** | The five from the spec plus **Fulfilment staff** (packing and shipping, no revenue visibility) and **Support agent** (orders and exchanges). |
| 24 | GST registration (2026-10-15) | **Uttar Pradesh (Lucknow), `IN-UP`** | Registered and warehouse state for CGST+SGST (deliveries within UP) versus IGST (other states). Apparel GST 5% up to ₹2,500 per piece and 18% above; prices include GST. The CA still confirms the slab rules (doc/10 A14). |
| 25 | Phase 3 integrations (2026-10-15) | **Razorpay test keys available; courier APIs not yet** | Checkout uses real Razorpay test mode (keys in `.env`, never committed). Courier rates come from the fake provider until Shiprocket and Shiprocket X accounts exist (Phase 4); the fake is refused in production. |

## 3. Requirements that follow from these decisions

These follow from the decisions and from Indian rules. They are planned and costed even though nobody asked for them directly:

1. **COD eligibility rules.** Partial COD is allowed only if the PIN code is COD-serviceable (per Shiprocket), the order is within a configurable value cap, the phone number is verified, and the customer is not on a COD blocklist. The advance amount can be configured as a fixed amount or a percentage.
2. **Courier collects only the balance.** For partial-COD orders, the amount Shiprocket collects must equal the unpaid balance. **⚠ Verify** the exact Shiprocket order fields with Shiprocket support before building, because the public docs don't show a field for an advance payment.
3. **COD remittance reconciliation.** Record COD money that Shiprocket remits, and mark an order fully paid when its balance is received.
4. **Wallet as a payment method.** Store credit can be combined with Razorpay, and with partial COD. Store credit can't be withdrawn or transferred: it is a closed-loop instrument usable only at Duis.
5. **Exchange price differences.** When the replacement costs more or less, the difference is collected through Razorpay or credited to the wallet. (Confirm the policy; see [10-open-questions.md](10-open-questions.md).)
6. **Tax lines saved at order time.** HSN code per product, GST slab rules with effective dates, and intra-state versus inter-state split based on the warehouse state and the delivery state.
7. **SMS used only for OTPs.** Needs DLT registration of the entity, sender header and OTP template. Choosing one provider that offers both SMS and WhatsApp (for example MSG91 or Gupshup) keeps the vendor count down.
8. **Legal storefront content.** Seller details, grievance officer, policies, country of origin, MRP inclusive of taxes, and full price breakdown before payment. See [08-security-compliance.md](08-security-compliance.md).
9. **Consent management.** Analytics and marketing tags load only after consent. Marketing messages (abandoned cart, back in stock) respect the customer's opt-in.

## 4. Assumptions (please confirm or correct)

These are defaults we will build on unless you say otherwise. Each one is also listed in [10-open-questions.md](10-open-questions.md).

- English only. INR only. Shipping across India and worldwide from launch (decision 22).
- Displayed prices **include GST** (legally required for consumer prices). The variant's original price is its MRP.
- No backorders and no pre-orders. A size with zero available stock can't be bought, but customers can subscribe to a back-in-stock alert.
- At most **one coupon per order**. Automatic discounts can stack with a coupon only if both are marked combinable.
- Wishlist requires login, matching the account-required checkout.
- Reviews are **moderated before they are published**, and only verified buyers can review.
- Staff accounts (all admin and CMS roles) must use **two-factor authentication** (TOTP).
- Roles and their permissions are **defined in code**: the seven roles in decision 23. Super Admins assign roles to staff in the admin portal, but can't create new permission sets from the UI.
- An order number looks like `DUIS-100001`.
- Search uses PostgreSQL full-text search with trigram fuzzy matching. We will reconsider Meilisearch only if relevance testing shows it is needed.

## 5. Out of scope for the first release

- Native mobile apps and a public REST API (the architecture keeps both possible)
- Customer-initiated returns for refund (exchange only), refunds to bank accounts or UPI, and payouts
- Cash on delivery without an advance
- Gift cards, loyalty and membership programmes, referral programmes
- Multi-warehouse routing and split shipments (schema-ready only)
- CSV or spreadsheet catalogue import (planned as a follow-up)
- GST invoice PDF generation (handled by the external tool)
- Hindi or other languages
- Self-hosted analytics (Umami) and a full observability stack (Grafana, Prometheus, Loki)

## 6. Definition of done (acceptance scenarios)

The release is complete when all four scenarios pass end to end on the production-like Docker stack (see [09-testing-strategy.md](09-testing-strategy.md)).

**Customer.** A customer:
1. Browses a collection and opens a T-shirt.
2. Picks a colour and size, and sees the correct price, MRP and live availability for that exact variant.
3. Checks delivery to their PIN code using real Shiprocket serviceability data. No delivery estimate is invented.
4. Adds the item to the cart and applies a valid coupon.
5. Signs in with phone OTP.
6. Chooses full prepaid or partial COD, and optionally uses wallet credit.
7. Pays through Razorpay, gets an email and a WhatsApp confirmation, and tracks the shipment in their account.
8. Requests a size exchange after delivery.

**Administrator.** An administrator:
1. Creates a category and adds a product.
2. Generates the colour × size variants in bulk and sets prices and stock.
3. Creates a manual collection and an automatic one, and creates a coupon.
4. Receives an order, creates the Shiprocket shipment with AWB and label, and follows it to delivery.
5. Approves an exchange, adjusts inventory, and reviews the audit log.

**CMS.** A content manager:
1. Uploads a banner and builds a homepage hero.
2. Selects a featured collection and reorders the homepage sections.
3. Previews the draft, then publishes it or schedules it.
4. Sees the live storefront update without a rebuild or redeploy.

A Content Editor in the same scenario can save drafts but can't publish.

**Deployment.**
1. The stack is deployed on a Linux VPS with Docker Compose behind Cloudflare and Nginx over HTTPS.
2. Containers restart without losing data.
3. A deploy causes no downtime and can be rolled back to the previous version.
4. A backup is restored to a fresh server by following the runbook.

# 10 — Open Questions & Activation Checklist

The 20 major decisions are settled (see [01](01-requirements-and-decisions.md#2-business-decisions-answered-2026-10-13)). What remains are **policy values** (stored as admin settings, so they can change later without code), **assumptions to confirm**, and **external accounts**, some of which take a long time to set up.

## 1. Policy questions (needed before the phase shown)

| # | Question | Needed by | Proposed default |
|---|---|---|---|
| P1 | **Partial-COD advance:** fixed amount or % of the order? Which value? | Phase 3 | Fixed ₹100 |
| P2 | Maximum order value allowed for partial COD | Phase 3 | ₹2,500 |
| P3 | COD handling fee on top of the advance? | Phase 3 | ₹5 (no fee) |
| P4 | **If a partial-COD parcel is refused or returned to origin:** refund the advance, credit it to the wallet, or keep it to cover shipping? | Phase 3 | Keep it (covers two-way shipping), with this stated clearly at checkout and in the policy |
| P5 | Free-shipping threshold and flat fee below it | Phase 3 | Free at or above ₹999, otherwise depend on pin-codes |
| P6 | Reservation hold time during payment | Phase 3 | 15 minutes |
| P7 | **Exchange window** after delivery, and categories excluded (for example innerwear, sale items) | Phase 5 | 10 days. Innerwear excluded. |
| P8 | Exchanges allowed per item | Phase 5 | 2 |
| P9 | **Exchange price difference:** allow a replacement at a different price (pay or credit the difference), or same price only? | Phase 5 | Allow it: pay the difference through Razorpay, or get credit to the wallet |
| P10 | Reverse pickup for exchanges: free for the customer, or a fee? | Phase 5 | Free |
| P11 | Damaged or wrong items: refund to the original method, wallet credit, or replacement only? COD-paid amounts can't go back to a card, so wallet or bank? | Phase 4 | Replacement first. Otherwise refund the online part to source and credit the COD part to the wallet. |
| P12 | Does wallet credit expire? Any cap on wallet use per order? | Phase 3 | No expiry. No cap. |
| P13 | Can a coupon combine with automatic sale discounts by default? | Phase 3 | No (set per discount) |
| P14 | Review publishing: moderate first (assumed), or auto-publish 4–5★ text-only reviews? | Phase 5 | Moderate everything |
| P15 | Abandoned-cart timing and channel: email only, or WhatsApp too (needs marketing opt-in and costs per message)? | Phase 5 | Email at 1 hour and 24 hours |
| P16 | Back-in-stock channel: email only, or WhatsApp too? | Phase 5 | Email; WhatsApp if opted in |
| P17 | Order-number format | Phase 3 | `DUIS-100001` |
| P18 | Sizes per category (alpha S–3XL for tops, waist 28–40 for bottoms) and extra filter attributes (fit, sleeve, neck, pattern, material) | Phase 1 | As listed |
| P19 | Do you need roles beyond the five in the spec, for example **Fulfilment staff** (packing and shipping only, no revenue visibility) or **Support agent** (orders and exchanges only)? | Phase 1 | Add both. Cheap now, awkward to add later. |
| P20 | Backup targets: is RPO ≤ 5 minutes and RTO ≤ 2 hours acceptable? | Phase 7 | Yes |
| P21 | Canonical host: `duis.<tld>` or `www.duis.<tld>`? | Phase 7 | Apex |

## 2. Assumptions to confirm

These come from [01 §4](01-requirements-and-decisions.md#4-assumptions-please-confirm-or-correct).

- [ ] English only, INR for india and other country , world wild shipping
- [ ] Prices include GST. The variant's MRP is the "original price".
- [ ] No backorders or pre-orders
- [ ] One coupon per order
- [ ] Wishlist requires login
- [ ] Staff 2FA mandatory
- [ ] Roles defined in code (no UI permission editor)
- [ ] Postgres full-text search at launch (Meilisearch only if needed)
- [ ] GitHub Actions runs checks on PRs (free private-repo minutes are enough), even though deploys build on the server
- [ ] A staging environment (small separate VPS, or a Compose project behind Cloudflare Access) for real Razorpay test mode and Shiprocket checks

## 3. Vendor choices still open

| Item | Options | Recommendation |
|---|---|---|
| SMS (OTP) + WhatsApp provider | MSG91, Gupshup, Interakt/AiSensy (WhatsApp only), Twilio | **One provider for both SMS (DLT) and WhatsApp** (MSG91 or Gupshup). Compare current pricing pages before choosing. |
| Transactional email | Amazon SES, Zoho ZeptoMail, Brevo, Resend | Any SMTP provider works (Nodemailer). SES or ZeptoMail for cost and deliverability. **Never** a self-run mail server. |
| Error tracking | Sentry SaaS (free tier) or self-hosted GlitchTip | Sentry SaaS to start (zero operations, PII scrubbed). GlitchTip if data must stay in-house. Same SDK either way. |
| External uptime monitor | UptimeRobot, Better Stack, Uptime Kuma on another host | Any free tier. It must run **off** the production server. |
| VPS provider | AWS Lightsail/EC2 Mumbai, DigitalOcean Bangalore, E2E Networks, Linode/Akamai Mumbai | Choose on price for 8 vCPU / 16 GB, snapshot support and a firewall API |
| Backup bucket | Backblaze B2, Cloudflare R2, AWS S3 | B2 or R2 (low cost, S3 API, object lock or versioning) |
| External GST invoicing tool | Zoho Books, Tally, Shiprocket invoices | Tell us which one, so the export columns match its import format (Phase 4) |

## 4. External activation checklist (start early, since some take weeks)

| # | Item | Lead time | Needed by | Owner |
|---|---|---|---|---|
| A1 | Register the domain and add it to Cloudflare | 1 day | Phase 7 (staging earlier) | You |
| A2 | **SMS DLT registration:** principal entity, sender header, OTP content template (through the chosen provider) | **1–3 weeks** | Phase 5 (development uses the fake) | You |
| A3 | **WhatsApp Business:** Meta Business verification, BSP onboarding, display name, template approvals | **1–3 weeks** | Phase 5 | You |
| A4 | Razorpay account: test keys now, **live KYC** (business documents, bank account, website with policies live) | Test: immediate. Live: days to weeks. | Test: Phase 3. Live: Phase 8. | You |
| A5 | Shiprocket account: KYC, pickup address (warehouse), API user, webhook token | Days | Phase 4 | You |
| A6 | Google Cloud OAuth client (consent screen, authorised redirect URIs) | 1 day (verification may take longer) | Phase 2 (development client), Phase 8 (production) | You / us |
| A7 | Transactional email account plus DNS (SPF, DKIM, DMARC) | 1–2 days | Phase 3 (development uses Mailpit) | You / us |
| A8 | VPS provisioning (8 vCPU / 16 GB, Ubuntu LTS) | Hours | Phase 7 (staging earlier) | You |
| A9 | S3-compatible backup bucket plus access keys. Store the restic and pgBackRest passwords in a password manager. | Hours | Phase 7 | You |
| A10 | Cloudflare Origin CA certificate, Turnstile keys, WAF and cache rules | Hours | Phase 7 | Us |
| A11 | GA4 property, Meta Pixel and Conversions API access token | Hours | Phase 5 | You |
| A12 | Sentry (or GlitchTip) project and DSN | Hours | Phase 1 | Us |
| A13 | **Legal content:** legal entity name, registered address, GSTIN, grievance officer, privacy, terms, shipping, exchange and cancellation policies (lawyer-reviewed) | 1–2 weeks | Phase 6 content / before Razorpay live KYC | You |
| A14 | **GST:** your CA to confirm HSN codes per category, the slab interpretation (₹2,500 per piece, before or after tax, effect of discounts), and that tax on shipping and COD fees is handled correctly | 1 week | Phase 3 | You + CA |
| A15 | Brand assets: logo (SVG source), any colours or fonts you want kept. Otherwise we propose a bold-streetwear identity for approval. | — | Phase 2 | You |
| A16 | Real catalogue: product data, size charts, photography (to replace the demo seed) | Ongoing | Phase 8 | You |

## 5. Items to re-check against live documentation when implementation starts (⚠ Verify)

1. `create-next-app` and `shadcn init` flags (shadcn CLI 4 removed several flags; run `--help` first).
2. Whether TypeScript 7 works with Next 16.4's type-checking; otherwise pin 5.x.
3. Whether Drizzle 1.0 is stable yet (it was RC 4 on 2026-10-13); see the migration guide if we adopt it.
4. pg-boss 12: enqueuing inside an existing transaction (custom database executor) versus an outbox table.
5. **Shiprocket: how to represent a partial-COD collectable amount** (only the balance as the COD amount), webhook URL rules, token lifetime, reverse-pickup API for exchanges.
6. Razorpay: auto-capture configuration, current webhook event names and headers (`x-razorpay-event-id`).
7. Better Auth 1.7: `phoneNumber`, `twoFactor`, `admin` and access-control APIs, the Drizzle schema generation command, and IP header configuration behind a proxy.
8. Node 26 LTS date and Next.js support for it before switching the runtime.
9. Current GST notifications for apparel (rate slabs and thresholds) at the time of launch.

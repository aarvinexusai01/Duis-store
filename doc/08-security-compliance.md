# 08 — Security & Compliance

## 1. What we protect, and from whom

**Assets:**
- Customer personal data: names, phones, emails, addresses, order history
- Money flows: payments, refunds, wallet balances, COD
- Stock integrity
- Staff accounts (one admin takeover means complete compromise)
- Secrets: Razorpay, Shiprocket, SMTP, WhatsApp/SMS, backup keys
- Brand trust: the storefront content and checkout

**Likely threats:**
- Credential stuffing and account takeover
- OTP/SMS pumping fraud
- Coupon brute-forcing and abuse
- Fake COD orders
- Forged payment confirmations and webhooks
- Price or total tampering
- Overselling races
- Stored XSS through CMS or reviews
- Malicious uploads
- Exposed database or admin panels
- Leaked `.env`
- Lost or unrestorable data

## 2. Controls

| Area | Controls |
|---|---|
| **Authentication** | Better Auth: hashed passwords (library default, scrypt), email verification, single-use expiring reset tokens, database sessions (revocable, `httpOnly`, `Secure`, `SameSite=Lax`), session list with "sign out other devices". **Staff must use TOTP 2FA**, enforced before any `/admin` page or staff action. Leaked-password check on sign-up and password change (evaluate the Better Auth plugin). |
| **Authorization** | Permissions defined in code (`createAccessControl`). `requirePermission()` inside **every** service entry point. Pages and `proxy.ts` only do optimistic redirects. An RBAC matrix integration test covers every action × role. Customers can only access their own resources (ownership checks in repositories, never just by ID). |
| **Input validation** | Zod at every boundary. Unknown keys stripped. Length limits on all strings. Explicit coercion for numbers. |
| **Money integrity** | Server-side quote only. Client totals ignored. Integer paise. Database CHECKs. State machines. Idempotency keys. Razorpay checkout signature check **and** server-side payment fetch with amount/currency match. |
| **Webhooks** | Raw-body HMAC (Razorpay) or token header (Shiprocket), checked in constant time. Event deduplication table. Fast 200 then asynchronous processing. Payloads saved for audit. Skip rules in the Cloudflare WAF so providers aren't challenged. |
| **CSRF** | Server Actions' built-in Origin check. Better Auth CSRF and `trustedOrigins`. Mutating route handlers check `Origin`. `SameSite=Lax` cookies. |
| **XSS** | React escaping. Rich text stored as Tiptap JSON and rendered through an allow-list renderer: no raw HTML from the CMS, reviews or product descriptions. Any `dangerouslySetInnerHTML` needs review and is restricted to JSON-LD (built with `JSON.stringify` plus `<` escaping). **CSP with per-request nonces** (set in `proxy.ts`) allow-listing only self, Razorpay (`checkout.razorpay.com`, `api.razorpay.com` frames), GA4/GTM and Meta. `frame-ancestors 'none'`. |
| **SQL injection** | Drizzle query builder and parameterised `sql` templates only. ESLint rule forbids `sql.raw` outside migrations. |
| **Uploads** | Staff-only route (and authenticated customers for review and exchange photos, with per-user quotas). Size limits at Caddy and in the app. Magic-byte allow-list (JPEG, PNG, WebP, AVIF; **no SVG, no HTML**). `sharp` `limitInputPixels`. Full re-encode strips metadata. Random content-hashed names. Served with `nosniff` and correct `Content-Type` from a path that never executes code. |
| **Rate limiting and abuse** | Better Auth rate limits stored in the database (shared across replicas). Per-phone, per-IP and per-day OTP caps, with **Turnstile** on OTP, register and login. App limiter on coupon apply, PIN-code check, search suggestions and contact form. Cloudflare rate rule on `/api/auth/*`. COD controls: verified phone, order cap, blocklist, RTO-history signal. |
| **Secrets** | `.env.production` on the server only (owner `deploy`, permissions 600), never in git. `.env.example` has placeholders. Separate secrets per environment. Rotation runbook. Server code reads them only through `src/config/env.ts`. Only `NEXT_PUBLIC_*` values (Razorpay key ID, Turnstile site key, GA4/Pixel IDs) reach the browser. Gitleaks in CI. |
| **Database** | Not published on any host port. `internal` Docker network. Separate `duis_owner`/`duis_app`/`duis_readonly` roles. The app role can't run DDL and has only INSERT/SELECT on append-only tables. `statement_timeout`. Backups encrypted. |
| **Containers** | Non-root users. Read-only root filesystems with tmpfs. `no-new-privileges`. All capabilities dropped (Caddy keeps `NET_BIND_SERVICE`). Images pinned by digest. Image scanning (Trivy) in CI. Minimal runtime images (no build tools, no npm in the runtime stage). |
| **Edge and host** | Cloudflare proxy, origin firewall limited to Cloudflare ranges, SSH keys only, unattended security upgrades, Docker log rotation, no admin UIs exposed publicly (no pgAdmin, no Mailpit in production). |
| **Audit** | `audit_logs` for every staff mutation, role change, refund, wallet credit, stock adjustment, CMS publish and settings change, plus auth events (staff sign-ins, 2FA changes, failed-login bursts). The viewer requires its own permission. |
| **Privacy in telemetry** | pino redaction paths (password, token, OTP, authorization, card-like strings). Sentry `beforeSend` scrubbing. Emails and phones masked in logs. Meta CAPI receives only hashed identifiers, and only after consent. |
| **Dependencies** | Lockfile committed. `npm ci` everywhere. Dependabot. `npm audit --omit=dev` gate on high and critical in CI. Every new dependency needs a written reason in its PR (spec §3.5). |

## 3. Indian legal requirements that shape the product

> Planning notes, not legal advice. Have your lawyer and CA confirm them before launch.

| Requirement | Product impact |
|---|---|
| **Consumer Protection (E-Commerce) Rules, 2020** | Show the seller's legal name, address, GSTIN and contact details. Publish a **grievance officer** (name, contact). Acknowledge complaints within 48 hours and resolve within one month. Clear exchange, cancellation, shipping and refund policies. Total price with every charge shown before payment. Country of origin on listings. No manipulated prices. All of this is held in CMS site settings and policy pages. |
| **Legal Metrology (Packaged Commodities) Rules** | Product pages show MRP (inclusive of all taxes), country of origin, manufacturer, packer or importer name and address, net quantity, generic name, and consumer-care contact. These are product fields, required before an item can be published. |
| **CCPA Guidelines on Dark Patterns, 2023** | No false urgency or scarcity: "Only N left" appears only when it is true, below a threshold. No basket sneaking (nothing auto-added, no pre-ticked add-ons). No drip pricing (COD fee and shipping shown before the payment step). No confirm-shaming. No forced sign-up beyond what is needed (we require an account at checkout, so make OTP sign-in fast and explain why). Subscriptions are easy to cancel. |
| **DPDP Act 2023 + DPDP Rules 2025** (core obligations due by **13 May 2027**) | Privacy notice in plain language. Consent for marketing and analytics, separate from consent needed for purchases, recorded in `consent_records` and withdrawable. Data minimisation. Account deletion and data export flows. Breach response runbook. Retention schedule (orders kept for tax purposes, see below; marketing data deleted when consent is withdrawn). We are building to the full standard now so there is no retrofit. |
| **GST record keeping** | Order and tax records kept for at least **72 months** (CGST Act s.36). Account deletion **anonymises** personal data but keeps the financial records. |
| **BIS IS 19000:2022 (online consumer reviews)** | Verified buyers only. No paid or incentivised reviews without disclosure. Moderation criteria published. Negative reviews are not suppressed. Ratings show the total count. |
| **TRAI DLT (SMS)** | OTP SMS can only use a registered entity, header and template. Wire the template ID into the SMS adapter. |
| **WhatsApp Business policy** | Only pre-approved templates outside the 24-hour customer service window. Explicit opt-in. Opt-out honoured. |
| **RBI: closed-system prepaid instruments** | The wallet is store credit, usable only at Duis, never withdrawable as cash and never transferable. That keeps it outside the semi-closed PPI licensing regime. Confirm with your CA. |
| **Payment card security (PCI DSS)** | No card data ever touches our servers. Razorpay Checkout handles it, which keeps our PCI scope minimal. |

## 4. Phase 8 security review checklist

- [ ] Every Server Action and route handler is listed, with its permission and an ownership test (an automated listing script).
- [ ] RBAC matrix tests pass. A Content Editor can't publish, and a customer can't reach any `/admin` action through a direct POST.
- [ ] Webhook replay and duplicates make no change. A bad signature gets a 401 and the event isn't stored as processed.
- [ ] Tampering with price, quantity or total in requests has no effect. Negative or overflow quantities are rejected.
- [ ] The upload fuzz set is rejected (SVG with script, polyglot JPEG/HTML, oversized dimensions, renamed EXE).
- [ ] CSP has no `unsafe-inline` for scripts. Headers are verified on securityheaders.com.
- [ ] OTP, login and coupon rate limits are proven by tests. Turnstile is enforced in production.
- [ ] `nmap` from outside shows only 443 (from Cloudflare) and SSH (from allowed IPs). Postgres is unreachable.
- [ ] Secrets scan is clean. `.env*` is excluded from git and from the Docker build context.
- [ ] `npm audit` and Trivy show no unresolved high or critical issues (or have a documented exception).
- [ ] Backup restore drill passes and the backup encryption keys are stored off-server.
- [ ] Staff 2FA is enforced, and the super-admin recovery procedure is documented.

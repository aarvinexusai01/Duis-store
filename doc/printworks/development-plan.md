# DUIS Printworks — Development Plan

**Status:** discovery finished on 2026-11-02 (11 rounds, recorded in [Appendix C](appendix-c-requirements-register.md)). This plan is a draft for the owner's review.

- Nothing has been built yet.
- Duis-store's application code isn't changed; this plan directory (`doc/printworks/`) is the only addition to that repository.
- All new work happens in a new repository.

## Context

**What DUIS Printworks is:** a new, independent web shop for:
- custom printing and logo merchandise;
- personalised products;
- corporate gifting.

The same company runs the Duis men's-fashion store, under the same GSTIN.

**The reference site:** PrintMine.in shows the business model and how customers order.

**What Printworks keeps from PrintMine:**
- small minimum quantities;
- prices that drop as quantity rises;
- upload a logo and see a preview;
- approval before anything is printed;
- partial cash on delivery;
- dispatch from its own factory.

**What it fixes:**

| PrintMine today | Printworks |
|---|---|
| Approvals and bulk quotes happen on WhatsApp and email | They happen in the app, on the record |
| Quantity prices are faked as product variants | A real price-band engine |
| No company details at checkout | Company name and GSTIN at checkout |
| No view of where an order is in production | Production progress shown to customers |

**How it gets built:** a new repository, created by copying and adapting the Duis-store code that already fits:
- sign-in and roles;
- the business-operation framework;
- payments, shipping and notifications;
- the CMS, the admin portal and the server operations tooling.

That cuts the platform work by about 70–75% and the whole job by about half ([Appendix B.7](appendix-b-duis-reuse-report.md)).

**What this plan does:** it gives a development team everything it needs to build without reopening business decisions.

**Words used in this plan:**

| Term | Meaning |
|---|---|
| **Slab** | A quantity band with its own per-piece price, e.g. 20–29 pieces at ₹494 each |
| **Blank** | The unprinted item (a plain T-shirt, a pen) before decoration |
| **Proof** | The designer's final artwork, which the customer approves before printing |
| **Station** | A production area tied to one print method (DTF printing, laser engraving, sublimation) |
| **MOQ** | Minimum order quantity |
| **DTF** | Direct-to-film printing |
| **RTO** | Return to origin: a parcel the courier brings back to us |
| **POS** | Place of supply (decides CGST + SGST versus IGST) |
| **LUT** | Letter of Undertaking: lets exports go out without paying IGST |
| **GSTR-1** | The monthly GST return that lists every sale |
| **HSN / SAC** | Tax classification codes for goods / services |
| **R-number / A-number** | A confirmed requirement / an assumption still to be confirmed ([Appendix C](appendix-c-requirements-register.md)) |

**How to read it:** sections 0–17 below are the plan the owner asked for. [Appendix A](appendix-a-printmine-analysis.md) (the PrintMine analysis), [Appendix B](appendix-b-duis-reuse-report.md) (the Duis code-reuse report) and [Appendix C](appendix-c-requirements-register.md) (the requirements register) are separate files in this directory; [README.md](README.md) lists them.

---

## 0. Decisions at a glance

| Area | Decision |
|---|---|
| Model | Hybrid: instant checkout at listed slab prices, plus in-app quotes (R6, R18) |
| Customers | Individuals and businesses; GSTIN, company name and billing address saved on the buyer's own account (R13) |
| Catalogue at launch | Apparel (tees, polos, hoodies, caps) and Gifts & merch (pens, keychains, badges, bottles, diaries, desk items, joining kits) (R9) |
| Kits | Joining kits and gift sets are products made of several items; each item is printed at its own station, then the kit is assembled; stock is reserved per item (R46) |
| Production | Own factory (UP). Blank stock tracked. Jobs routed automatically to a station by print method. Standard stages (R7, R31, R32) |
| Decoration | One fixed method per product; customers choose print positions, and each extra position costs a set amount per piece (R14) |
| Slabs | Counted per product + colour (or model) across the cart; MOQ and step per product (R15, A2, A19) |
| Customisation | Sign in → upload artwork → instant automatic mockup → designer's proof → in-app approval. Live editor in v2 (R8, R47) |
| Artwork files | PNG, JPG, WebP, SVG, PDF, AI; up to 50 MB; stored in private Cloudflare R2 (R39, R44) |
| Design fees | Free, with unlimited revisions (R17); per-piece names are a free-text note (R16) |
| Payment timing | Instant orders: pay → proof → approve. Quotes: mockup with the quote → accept → advance → production → balance before dispatch (R10, R19) |
| Payment methods | Razorpay prepaid, plus partial COD (India). No wallet, no credit terms (R11, R43) |
| Shipping | India: free at or above a set order value, otherwise the live Shiprocket rate. International: prepaid only, live rate. Several addresses = one order per address (R25, R29, R42) |
| Cancellation | Self-service within 2 working hours of payment, before design starts; staff can always cancel and refund (R20) |
| Proof not answered | Reminders on days 1, 3 and 7, then staff follow-up; never auto-approve, never auto-cancel (R21) |
| Claims | By email or WhatsApp. Staff record a free reprint or a refund (R22) |
| Invoices | In-app GST invoices and credit notes, with their own series per financial year; no e-invoicing while turnover < ₹5 cr (R12, R35, R40) |
| Account | Sign-in required (phone OTP, email or Google). Reorder, saved logos, production progress, wishlist (R26, R27) |
| Notifications | Email + WhatsApp; SMS only for login codes (R28) |
| Staff roles | 11 staff roles + customer (R30) |
| Engagement | Reviews, coupons and discounts, newsletter and abandoned-cart emails, blog (R45) |
| Brand | Its own clean, professional look; linked to Duis only by name (R34) |
| Infrastructure | Own VPS; lean stack (1 web container, worker, Postgres, Nginx); no Redis or Elasticsearch at launch (R36, R37) |
| Repository | New repo; copy and adapt the files listed in B.2 from a pinned Duis commit (R38) |

---

## 1. Project overview & objectives

### Who it's for
- Individuals ordering personalised items.
- Startups and SMEs.
- HR and admin teams (joining kits, uniforms).
- Schools, colleges and event teams.
- Corporate gifting buyers.

### Shape of the application
**Three interfaces in one Next.js app:**
- the storefront;
- the admin portal (`/admin`), covering operations, design, production, quotes, accounts and settings;
- the CMS (`/admin/cms`).

**How it runs:**
- One login system with role-based access.
- One Postgres database.
- A background worker for heavy and slow work (previews, PDFs, notifications, courier and payment syncs).

### Objectives
1. A standard job (configure, upload, preview, pay) takes **under 3 minutes** on a phone.
2. **Nothing is printed without an approved proof recorded in the app.** The record holds the proof version, the time, who approved and through which channel.
3. Quote requests are answered, accepted and paid **inside the app**. Turnaround and conversion are measured.
4. Every dispatched order has a **GST-correct invoice**. Business buyers get their GSTIN on it automatically.
5. Staff see **every job's stage at every station**, and customers see progress without having to ask.
6. Launch on a **lean, independent stack** that reuses Duis's tested foundations: payments, concurrency, permissions, operations.

### Out of scope for v1
These are deliberately left out; Section 17 has the roadmap.
- Live canvas editor
- Structured per-piece names list
- Company teams, credit terms, purchase orders
- Paper and large-format printing
- Express production
- Claim form
- Wallet
- Guest checkout
- E-invoicing
- Multiple currencies
- Public API
- Hindi interface
- Redis, Elasticsearch and a second web replica

---

## 2. Functional requirements

**Catalogue and pricing**
- **FR-1** Products are blanks with variants (colour, or model / shape / type, × size). Apparel uses size charts with an inch / cm switch (reused). Kits are covered by FR-52–FR-54.
  - Each product has **one fixed decoration method**, which is shown to customers.
- **FR-2** Each product has **print positions**, each with:
  - a label;
  - whether it's included in the price, or its per-piece add-on price;
  - the maximum print width and height in millimetres.
- **FR-3** Each product has **quantity slabs** (minimum quantity – maximum quantity → per-piece price), which can be overridden per colour or model.
  - The slab count is all sizes of one product + colour across the cart (A19).
  - The product page shows the slab table, cards show "from ₹X/pc · Min N", and the compare-at price (MRP) drives the "% off" figure.
- **FR-4** Each product has an **MOQ and a quantity step**, enforced per colour group.
  - These show **"Request a quote"** instead of Add to cart:
    - quantities above the top slab;
    - quote-only products;
    - special packaging;
    - delivery to several addresses.
- **FR-5** Stock is tracked per blank SKU at the factory.
  - Sold-out colours and sizes can't be ordered.
  - Checkout reserves stock per size, oversell-safe (reused).
- **FR-6** GST comes from HSN tax rules, with per-piece price thresholds:
  - garments 5% up to ₹2,500 per piece, 18% above;
  - gifts 18%.

  Prices include GST, and position add-ons are folded into the unit price (A4).
- **FR-7** Coupons and automatic discounts (reused).
- **FR-8** Shipping fee within India: free at or above a threshold set in admin, otherwise the live Shiprocket rate for the PIN code and parcel weight. International orders pay the live rate. On quotes, staff set the fee.

**Artwork and mockups**
- **FR-9** Signed-in customers (R47) can upload PNG, JPG, WebP, SVG, PDF and AI (PDF-compatible) files up to 50 MB.
  - A signed-out visitor is asked to sign in first (phone OTP takes seconds), then the upload continues. Until then, the product page shows the print areas with a "Your logo here" placeholder.
  - CDR, EPS and PSD are refused with "Export as PDF or PNG".
  - The customer must confirm they have the right to print the artwork (A18).
  - Each user has a daily upload quota.
- **FR-10** The server checks each file's real type from its first bytes (magic bytes), stores the original privately in R2, and makes a transparent PNG preview.
  - SVG, PDF and AI are turned into images (rasterised) in the worker.
  - A plain near-white background is removed automatically; the customer can switch this off.
- **FR-11** **Instant mockup:** the preview is placed in each chosen position's print area on the product photo for the selected colour.
  - It appears on the product page, in the cart, on the order and on the job sheet.
  - A combined mockup image is saved for each order design.
- **FR-12** Customers can order now and send artwork later. Each design has a free-text note for text-only orders, names and instructions.
- **FR-13** **Saved logos:** every upload stays in the account's artwork library and can be reused on any order.

**Cart and checkout**
- **FR-14** A cart line is a **design**: product + colour + positions (each with its artwork) + note + size mix.
  - Slab prices are recalculated live.
  - The cart works signed out and merges into the account at sign-in (reused).
- **FR-15** Checkout needs a signed-in account: phone OTP, email and password, or Google (reused).
- **FR-16** Checkout collects:
  - a country-aware delivery address;
  - optional business details: company name, **GSTIN** (checksum-validated) and billing address;
  - the payment mode: prepaid, or partial COD (India only, within the order-value cap and courier serviceability);
  - a coupon.

  It shows the full price breakdown with GST before payment.
- **FR-17** Payment through Razorpay: UPI, cards, netbanking and wallets, plus international cards charged in INR.
  - Placing an order is idempotent.
  - The server compares a hash of the price quote so a tampered total is refused (reused).

**Design approval**
- **FR-18** The **designer queue** lists every design in paid orders.
  - The designer claims a design, prepares a proof (PDF or PNG) and sends it.
  - Revisions are free and unlimited, but the number of rounds is counted.
- **FR-19** The customer gets an email and a WhatsApp message with a **signed link**.
  - The proof page shows the proof, the mockup and the print details.
  - A checklist covers spelling, colours, size and position.
  - The customer can **Approve**, or **Request changes** with a comment and an optional file.
- **FR-20** Each approval is recorded with the proof version, time, user or link, channel, IP address and browser.
  - Staff can also record an approval received by phone or WhatsApp, with a screenshot as evidence. This is audited.
- **FR-21** Reminders go out on days 1, 3 and 7 (configurable). After that the order is flagged for staff follow-up.
  - Never auto-approve and never auto-cancel.
  - Paid orders never expire.
- **FR-22** Production starts only when **every design in the order is approved**.

**Orders, cancellation and claims**
- **FR-23** The order states are listed in §6. Order numbers look like `DPW-100001`.
- **FR-24** **Self-service cancellation:** customers can cancel within **2 working hours of payment**, and only before a designer claims the design.
  - Working hours come from the business-hours calendar.
  - The refund is the full amount, to the original payment method.
- **FR-25** Staff can cancel and refund (partial or full) under the policy, with a reason. Every refund is audited (reused).
- **FR-26** Claims arrive by email or WhatsApp. Staff record either:
  - a **reprint**: a new production job plus a free replacement shipment; or
  - a **refund**.
- **FR-27** **Reorder:** puts a past order's designs (same artwork and positions) into the cart at today's prices.
  - If nothing is changed, the previous approval carries over (A22).

**Quotes**
- **FR-28** **Request a quote:** from a product page or a general page. The form takes:
  - products, quantities, colours and sizes;
  - positions and artwork (attaching files needs sign-in; artwork can also come later);
  - delivery addresses and a deadline;
  - company name and GSTIN.

  The form itself works signed out, like the contact form: contact details required, Turnstile and rate limits (A26). Staff can also create quotes from enquiries.
- **FR-29** **Quote builder.** Each line can be a catalogue product or a custom item (with its own HSN and tax rate), with a size breakdown and positions.
  - Price overrides need a reason and are audited.
  - The quote also holds shipping, a discount, a validity date (default 15 days), an advance percentage (default 50%) and terms.
  - Each line can carry a mockup or proof.
  - Revising a quote creates a new version.
- **FR-30** The quote goes out by email and WhatsApp with a signed link and a PDF.
  - The customer accepts it (signed in) and pays the **advance online**.
  - The proofs attached to an accepted quote count as approved.
- **FR-31** Staff convert a paid quote into **one order per delivery address**. Stock is reserved when the advance is paid (A11).
- **FR-32** The **balance is paid online before dispatch**; booking a shipment is refused until it is paid.
- **FR-33** Customers get reminders before a quote expires. Expired and declined quotes are tracked, and so is conversion.

**Production and fulfilment**
- **FR-34** Each order design becomes one **production job**, routed automatically to the station for its print method. The production manager assigns operators.
- **FR-35** Stages run Queued → Printing → Finishing → QC → Packed → Ready to dispatch.
  - Stages can be skipped.
  - Each move is timestamped, with who made it.
  - QC can send a job back to Printing.
- **FR-36** The **job sheet PDF** shows:
  - product and colour;
  - the size breakdown;
  - positions with their maximum print sizes;
  - the mockup and the approved proof;
  - a link to the print file;
  - the customer's note.
- **FR-37** When every job in an order is packed, Fulfilment books the shipment. Booking first issues the tax invoice (FR-39), since an e-way bill needs the invoice number, then books Shiprocket: AWB, label and pickup (reused).
  - Shipments worth more than ₹50,000 need an e-way bill number, which is recorded (A21).
- **FR-38** Tracking comes from courier webhooks, with polling as a fallback (reused).
  - The customer's timeline runs: design → proof → approved → production stages → shipped → delivered.
  - Customers can also track by order number + phone (rate-limited).

**Invoicing and accounts**
- **FR-39** One **tax invoice per order**, issued as the first step of booking its shipment (FR-37).
  - Numbered in its own series per financial year (`DPW/26-27/00001`, under GST's 16-character limit).
  - Holds snapshots of the seller and the buyer.
  - Place of supply follows A20; tax is CGST + SGST, IGST, or an export under LUT.
  - The PDF is available in the customer's account and in admin.
- **FR-40** Refunds after invoicing get **credit notes**. Accounts can cancel and re-issue an invoice to correct a GSTIN before the GSTR-1 cut-off.
- **FR-41** The GST export CSV uses the **Duis layout**, so the accountant can merge both businesses' sales into one GSTR-1.
  - Also: an invoice register and the COD remittance import (reused).

**Customer account**
- **FR-42** The account holds:
  - orders: detail, progress, proofs, invoices, tracking, reorder;
  - quotes, the artwork library, addresses and business details;
  - wishlist, reviews, profile and consents;
  - security: password, sessions and Google link.

**Notifications** (email and WhatsApp)
- **FR-43** Customer messages:
  - **Orders:** order placed; artwork needed; proof ready; proof reminders; approved / in production; cancelled or refunded.
  - **Delivery:** shipped; out for delivery; delivered.
  - **Quotes:** quote sent; quote reminders and expiry; quote accepted / advance received; balance due.
  - **Invoices:** invoice ready.

  Staff email alerts:
  - a new order, quote request or enquiry;
  - a customer asked for proof changes;
  - a proof follow-up is due;
  - the daily low-stock digest.

  SMS is used only for login codes. Marketing messages respect quiet hours, and STOP replies are honoured (reused).

**Engagement and content** (all reused)
- **FR-44** Reviews: verified buyers, photos, moderation. The "fit" field is dropped.
- **FR-45** Newsletter with double opt-in, and abandoned-cart reminders (consent-aware).
- **FR-46** CMS:
  - page builder with three new blocks (how it works, client logos, quote call-to-action);
  - menus, site settings, redirects;
  - the Journal blog;
  - SEO: metadata, sitemap and structured data.
- **FR-47** Consent banner; GA4; Meta Pixel and Conversions API.
- **FR-48** The contact form feeds the Messages inbox. Quote requests have their own flow.

**Admin**
- **FR-49** The admin modules are listed in §4.
  - Permissions follow §7.
  - Staff must use two-factor authentication (2FA).
  - Every staff change is written to the audit log.
- **FR-50** Reports:
  - sales and COD;
  - production;
  - quotes and sales;
  - design and proofs;
  - accounts: GST, invoices, money still to collect.
- **FR-51** Settings:
  - store and legal details;
  - invoice series;
  - business hours and holidays;
  - cancellation window;
  - proof reminder days and follow-up;
  - quote defaults;
  - production SLA (working hours);
  - free-shipping threshold;
  - partial COD: advance, cap, fee, RTO policy;
  - notifications;
  - tax rules;
  - integration health.

**Kits** (R46)
- **FR-52** A **kit** is a product made of a fixed list of items (components), such as a joining kit (T-shirt, bottle, diary, pen) or a diary + pen + keychain set. Each item has:
  - its blank: a fixed SKU, or for clothing a product and colour whose size comes from the kit's size;
  - a quantity per kit;
  - its own decoration method (station) and print positions.

  Kit types with different contents (e.g. Classic and Pro) are separate products.
- **FR-53** Kits are priced with their own slabs, MOQ and step, like any product.
  - A kit that includes clothing takes a size mix.
  - One logo fills every position by default; the customer can change it per position.
  - Availability is the number of complete kits the component stock allows, and ordering reserves stock per item.
- **FR-54** An approved kit design creates one production job per item at its station, plus a **kit-assembly job** that waits until every item's job is ready, then runs Finishing (assembly) → QC → Packed → Ready.

**Non-functional**
- **NFR-1** Mobile first. Lighthouse mobile score ≥ 90 on the home, listing and product pages. Accessibility checks (axe) show no serious violations.
- **NFR-2** The product-page preview appears **≤ 3 s** after uploading a raster file of up to 10 MB, and **≤ 10 s** for PDF or AI.
- **NFR-3** Money is integer paise everywhere. Prices, tax, stock and permissions are decided on the server only.
- **NFR-4** Backups: point-in-time recovery plus nightly encrypted backups off the server, and a restore drill. A deploy may interrupt service for a few seconds (A17).
- **NFR-5** Privacy (DPDP): consent records, and data export and deletion. Invoices are kept for 8 years as GST law requires.
- **NFR-6** Security as set out in §13.

---

## 3. Customer-facing modules

| Module | What the customer gets | Built from |
|---|---|---|
| Storefront browsing | Home page (CMS), category listings with filters and sort, collections (Joining kits, Best sellers), search (Postgres), cards showing "from ₹X/pc · Min N" | Duis catalogue, collections, CMS; cards changed |
| Product configurator (product page) | Gallery by colour; colour or model picker; size grid (per-size quantities, live stock); positions with add-on prices; slab table with live per-piece and total price; artwork upload (after sign-in) or pick from library; instant mockup; note; Add to cart or Request a quote; size chart; reviews. Kits list their items, each with its print method and positions | Duis product page plus **new** configurator |
| Artwork | Sign-in prompt for signed-out visitors, then upload with progress, file-type and size errors, rights checkbox, background-removal switch, library | **New** (based on Duis upload pattern) |
| Cart | Designs with their mockups and size mix; slab hints ("add 3 more for ₹X/pc"); coupon; summary | Duis cart, changed |
| Checkout | Address (country-aware); business details with GSTIN; payment mode (prepaid or partial COD); price breakdown; Razorpay | Duis checkout, changed |
| Proof centre | Proof page reached by signed link or from the account; approve or request changes; history of versions | **New** |
| Quotes | Request form; quote view (link and PDF); accept; pay advance and balance; quote list in the account | **New** (payments reused) |
| Account | Orders with progress timeline, proofs, invoices and reorder; quotes; artwork library; addresses; business details; wishlist; reviews; profile, consents and security | Duis account plus **new** pieces |
| Tracking | Signed tracking link from messages; lookup by order number + phone | Duis tracking plus lookup |
| Content | About, How it works, FAQ, policies (terms with an artwork rights clause, cancellation, shipping, privacy), contact form, Journal | Duis CMS and Journal |
| Engagement | Reviews, newsletter, abandoned-cart reminders, consent banner and analytics | Duis, reused |

---

## 4. Admin panel modules

| Module | Purpose | Main roles | Built from |
|---|---|---|---|
| Dashboard | Today's orders and revenue, designs waiting on artwork or approval, jobs by stage, overdue items, quote pipeline, low stock | Everyone (each sees their own widgets) | Duis dashboard, extended |
| Orders | List with views (Awaiting artwork, Proof pending, Follow-up due, In production, Ready to ship, COD to collect); detail with designs, payments, refunds, notes, history, shipments, invoices; staff cancel and refund; address correction; size swap before production (A24) | Store Admin, Support, Fulfilment, Sales, Accounts | Duis orders, extended |
| **Design workspace** | Queue of designs; claim; download originals; mockup; upload, send or record a proof; conversation history; follow-up flags | Designer, Support | **New** |
| **Quotes** | Enquiries inbox → quote builder → send, revise, track → convert into orders per address → collect balance | Sales | **New** |
| **Production board** | Jobs per station and stage; assign operators; move stages; QC; reprints; kit assembly (starts when all of a kit's items are ready); print job sheets; overdue | Production Manager, Production Operator | **New** |
| Shipments | Book (one or many), labels, pickup, cancel, tracking, RTO, e-way bill number | Fulfilment | Duis shipping, reused |
| **Invoices** | Invoice register, PDFs, credit notes, cancel and re-issue, GST export, money still to collect | Accounts | **New** |
| Products | Details, media, variants (generator), **slabs, positions, mockup templates, kit components**, inventory, SEO | Store Admin | Duis products, extended |
| Categories, attributes, size charts | Taxonomy, colour and size values, size charts | Store Admin | Duis, reused |
| **Stations (print methods)** | DTF, laser engraving, sublimation…, plus a Kit assembly station; operators assigned to each station | Store Admin, Production Manager | **New** (small) |
| Collections, discounts | Manual and rule-based collections; coupons and automatic discounts | Store Admin | Duis, reused |
| Inventory | Stock per SKU, receive, adjust, count, movements (including reprints), low-stock alerts | Store Admin, Production Manager | Duis, reused |
| Customers | List and detail: orders, quotes, artwork, business details, COD block | Support, Sales | Duis, extended |
| Messages | Contact form inbox | Support | Duis, reused |
| Reviews | Moderation | Support | Duis, reused |
| Reports | Sales, COD, production, quotes, design, accounts | Each by resource | Duis plus **new** reports |
| CMS, media, menus, redirects, Journal | Content | Content Manager, Content Editor | Duis, reused |
| Staff, audit, system | Invitations, roles, 2FA reset, sessions; audit log; job queues, dead letters, webhooks | Super Admin | Duis, reused |
| Settings | Store and legal, invoice series, business hours and holidays, cancellation window, proof reminders, quote defaults, production SLA, shipping threshold, partial COD, notifications, tax rules, integration health | Store Admin | Duis plus new fields |

---

## 5. Customisation and design-approval workflows

### 5.1 Artwork upload and preview
1. The customer chooses a file on the product page, or picks one from the library. If they aren't signed in, the phone-OTP sign-in opens first and the upload continues afterwards (R47). The browser posts the file to `POST /api/artwork` (multipart, signed in).
   - The **server** checks the size (≤ 50 MB) and the real file type from its first bytes.
   - Allowed types: PNG, JPEG, WebP, SVG, PDF, and AI (which is a PDF inside).
   - The rights checkbox must be ticked, and the user must be within their daily quota.
2. The original is streamed to **R2 (private)** under `artwork/{userId}/{artworkId}/original.{ext}`. An `artworks` row is created with status `processing`.
3. **Previews:**
   - **Raster files** (PNG, JPEG, WebP) are previewed straight away in the request with sharp: re-encoded to PNG, at most 1600 px, background knocked out if requested.
   - **SVG, PDF and AI** go to the `artwork.render` worker job:
     - SVG is rasterised with sharp (librsvg). SVGs containing scripts or external references are refused.
     - PDF and AI first pages are rendered with pdf.js on `@napi-rs/canvas`.
   - The status moves to `ready` (preview key, pixel size) or `failed` (message: "export as PNG").
4. The product page shows the preview **as an absolutely positioned `<img>` inside the print-area box**.
   - The box is stored as percentages of the mockup photo for each colour and position, so a CSS overlay does the job. No canvas library is needed for v1.
   - The page polls until the status is `ready`.
5. When the order is placed, the worker creates **combined mockup PNGs** for each order design (sharp composite: product photo + previews), stored privately. They are used in emails, the account, admin, proofs and job sheets.
6. **Low-resolution warning:** if the raster preview's estimated DPI at the position's maximum print size is under 150, the page warns "This image may print blurry — our designer will check it".

### 5.2 Mockup templates (admin)
For each product, the template lists every colour and side, each with:
- a photo from the media library;
- a print-area rectangle drawn on the image (stored as x, y, width and height in basis points);
- the position it belongs to;
- the maximum print size in mm.

Products without colours use one photo per model. Without a template, the product page shows the plain product photo and the line "Preview after design". For a kit, the template is a photo of the whole kit, with one print area per item position.

### 5.3 Proof cycle (one per order design)
```
awaiting_artwork ─(artwork attached)─► ready_for_design ─(designer claims)─► in_design
in_design ─(send proof vN)─► proof_sent ─(customer approves vN)─► approved
proof_sent ─(customer requests changes)─► changes_requested ─(send proof vN+1)─► proof_sent
any state before approved ─(order cancelled)─► cancelled
```
- **Proof versions:**
  - Each version is a file (PDF or PNG) plus a note to the customer.
  - Sending a new version supersedes the earlier one.
  - The revision count is kept for reporting.
- **Link:** each send creates a **signed link**. The token is stored only as a hash (reuses `src/server/security/tokens.ts`). It is valid for 30 days or until the proof is superseded, and it lets the customer view and approve without signing in.
- **Approve:** the customer ticks a checklist, then approves. This records the proof version, the time, the user ID (if signed in), `channel = link | account`, the IP address and the browser.
- **Request changes:** a comment (required) and an optional file.
- **Approval taken by phone or WhatsApp:** staff with `proof: record_approval` can record it with a screenshot as evidence. It is audited and flagged `channel = staff_recorded`.
- **Order status follows from its designs:**
  - any design not yet approved → `in_design`;
  - all approved → production jobs are created → `processing`.

### 5.4 Reminders and follow-up
- **Reminder job.** `proofs.remind` runs hourly. A proof unanswered for 1, 3 and 7 days (counted in working days) gets an email and a WhatsApp message.
- **Follow-up.** After the last reminder, the design is marked `follow_up_due`, which shows in Orders and on the dashboard.
- **What staff decide.** Staff either wait (and snooze the follow-up) or cancel and refund.
- **Expiry rule.** The `orders.expire-pending` job only ever touches **unpaid** orders.

### 5.5 Quote-attached proofs and reorders
- **Quote proofs:**
  - Each quote line can carry a proof. Accepting the quote counts as approving that proof (recorded as `channel = quote_acceptance`).
  - Lines with no proof go through §5.3 after the quote is converted.
- **Reorders:**
  - If the designs are unchanged (same artwork, positions and colour), the previous approved proof is attached and the design starts as `approved`, referencing the earlier approval (A22).
  - Any change starts a normal proof cycle.

---

## 6. Order lifecycle

### 6.1 Instant order, step by step
1. **Configure and add to cart.** The customer configures, uploads and adds to the cart. The server checks the MOQ, step, stock and slab price.
2. **Checkout.**
   - The customer signs in (OTP).
   - They choose the address, GSTIN details and payment mode.
   - The server quotes the price: slabs, add-ons, discounts, shipping, COD fee, GST.
3. **Place the order.** One transaction creates:
   - the order, its designs and its items;
   - per-size stock reservations (15-minute hold);
   - the coupon redemption;
   - the idempotency key.

   Status: `pending_payment`.
4. **Payment.**
   - Razorpay payment, then webhook or callback.
   - `confirmOrder` (idempotent) commits the stock.
   - It sets `cancel_until` = payment time + 2 working hours.
   - Status: `confirmed`.
   - Messages: order placed, and either "proof coming soon" or "please send artwork".
5. **Design.** The designer claims the design (no more customer cancellation) and sends the proof. Status: `in_design`.
6. **Approval.** The customer approves (or reminders and follow-up kick in). When every design is approved, jobs are created per design and station (for a kit, one job per item plus an assembly job). Status: `processing`. Message: "In production".
7. **Production.**
   - Stations move jobs through the stages.
   - QC can send a job back.
   - When every job is packed: `ready_to_dispatch`.
8. **Dispatch.**
   - Fulfilment starts booking, which first issues the **tax invoice**.
   - For goods worth more than ₹50,000, Accounts generate the e-way bill against that invoice and record its number.
   - Shiprocket is then booked (AWB, label, pickup).
   - Status: `shipped`, then courier updates bring `out_for_delivery` and `delivered`.
9. **After delivery.**
   - A review request goes out 5 days after delivery.
   - Claims arrive by email or WhatsApp; staff record a reprint or a refund (with a credit note).
   - For partial-COD orders, the COD remittance import marks the balance paid.

### 6.2 State machines
Each machine has one transition function that checks the move is allowed and writes a history row (Duis convention).

| Machine | States |
|---|---|
| `order.status` | pending_payment → confirmed → in_design → processing → ready_to_dispatch → shipped → out_for_delivery → delivered; plus cancelled, expired (unpaid only), rto_initiated → rto_delivered |
| `order.payment_status` | unpaid → partially_paid → paid → partially_refunded / refunded (reused) |
| `order_design.status` | awaiting_artwork → ready_for_design → in_design → proof_sent ⇄ changes_requested → approved; cancelled |
| `production_job.stage` | queued → printing → finishing → qc → packed → ready (forward skips allowed; qc → printing for rework; a kit's assembly job stays queued until every item's job is ready) |
| `quote.status` | draft → sent → accepted → advance_paid → converted; plus declined, expired, cancelled, superseded |
| `shipment.status` | Reused from Duis (pending → ready_to_ship → picked_up → … → delivered / rto) |

### 6.3 Cancellation rules
| Who | When | Result |
|---|---|---|
| Customer | `now < cancel_until` **and** no design has been claimed yet | Full refund to the original method, stock returned to shelf, coupon released |
| Staff (Support, Store Admin) | Before the parcel is picked up (Duis rule) | Refund, partial or full, with a reason; credit note if already invoiced; audited |
| System | Unpaid when the hold expires | `expired`; stock released |

The order page shows a live countdown while self-service cancellation is still open.

### 6.4 Quote lifecycle
1. **Request.** The request (or a staff-created draft) builds a quote: lines, prices with any overrides, shipping, validity, advance percentage, terms, proofs, delivery addresses.
2. **Send.** An email and a WhatsApp message carry a signed link and a PDF. Reminders go out before expiry.
3. **Accept and pay the advance.** The customer accepts (signed in) and pays the **advance** (`payments.quote_id`, purpose `advance`). Then:
   - status becomes `advance_paid`;
   - stock is reserved;
   - Sales is notified.
4. **Convert.** Sales convert the quote, allocating quantities to each address, which creates **one order per address**:
   - each child order starts `confirmed`, with `quote_id` set;
   - designs approved with the quote start `approved`;
   - shipping and discounts are split across the orders with `allocate()` (the Duis pricing engine).
5. **Production.** The orders run through the normal design and production flow.
6. **Balance.** When the first child order reaches `ready_to_dispatch`, a **balance** payment link goes out (purpose `balance`). Shipment booking for every child order is refused until it is paid.
7. **Invoices.** One per child order, issued when its shipment is booked.

### 6.5 Reprints
- Production Manager creates a reprint job, linked to the original job, for the affected quantity.
- The reprint shows up in the stock movements.
- It ships as a free **replacement** shipment (the Duis `replacement` shipment direction).
- No new invoice is issued, because nothing new is sold.

---

## 7. User roles and permissions

**How it works**
- Roles and their permissions are written in code (`src/server/auth/permissions.ts`), not configured in the UI.
- Every operation declares the permission it needs, and the RBAC matrix test calls **every operation with every role**.
- Every staff role needs 2FA.

**Role abbreviations**

| Code | Role | Origin |
|---|---|---|
| SA | Super Admin | Duis |
| ST | Store Admin | Duis |
| CM | Content Manager | Duis |
| CE | Content Editor | Duis |
| DS | Designer | **new** |
| SL | Sales / Quotes | **new** |
| PM | Production Manager | **new** |
| PO | Production Operator | **new** |
| FU | Fulfilment | Duis |
| SU | Support | Duis |
| AC | Accounts | **new** |

| Resource: actions | SA | ST | CM | CE | DS | SL | PM | PO | FU | SU | AC |
|---|---|---|---|---|---|---|---|---|---|---|---|
| catalog: read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| catalog: create / update / publish / archive | ✓ | ✓ | | | | | | | | | |
| inventory: read | ✓ | ✓ | | | | ✓ | ✓ | | ✓ | ✓ | |
| inventory: adjust | ✓ | ✓ | | | | | ✓ | | | | |
| collection, discount: manage | ✓ | ✓ | | | | | | | | | |
| media: read / upload / update | ✓ | ✓ | ✓ | ✓ | ✓ | | | | | | |
| media: delete | ✓ | ✓ | ✓ | | | | | | | | |
| artwork: read | ✓ | ✓ | | | ✓ | ✓ | ✓ | | | ✓ | |
| artwork: download originals | ✓ | ✓ | | | ✓ | | ✓ | ✓ | | | |
| artwork: upload on behalf of a customer | ✓ | ✓ | | | ✓ | ✓ | | | | | |
| proof: read | ✓ | ✓ | | | ✓ | ✓ | ✓ | | | ✓ | |
| proof: create / send | ✓ | ✓ | | | ✓ | ✓ | | | | | |
| proof: record_approval | ✓ | ✓ | | | ✓ | | | | | ✓ | |
| order: read | ✓ | ✓ | | | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| order: read_financials | ✓ | ✓ | | | | ✓ | | | | | ✓ |
| order: update / cancel | ✓ | ✓ | | | | | | | | ✓ | |
| order: fulfil | ✓ | ✓ | | | | | | | ✓ | | |
| order: refund / export | ✓ | ✓ | | | | | | | | | ✓ |
| quote: read | ✓ | ✓ | | | | ✓ | | | | ✓ | ✓ |
| quote: create / send / override_price / convert | ✓ | ✓ | | | | ✓ | | | | | |
| production: read | ✓ | ✓ | | | | | ✓ | ✓ | ✓ | | |
| production: update stage | ✓ | ✓ | | | | | ✓ | ✓¹ | | | |
| production: assign / reprint | ✓ | ✓ | | | | | ✓ | | | | |
| invoice: read | ✓ | ✓ | | | | ✓ | | | | | ✓ |
| invoice: issue / cancel / credit_note / export | ✓ | ✓ | | | | | | | | | ✓ |
| customer: read | ✓ | ✓ | | | ✓ | ✓ | | | | ✓ | ✓ |
| customer: update | ✓ | ✓ | | | | ✓ | | | | ✓ | |
| review: read / moderate | ✓ | ✓ | | | | | | | | ✓ | |
| cms: read | ✓ | ✓ | ✓ | ✓ | | | | | | | |
| cms: draft | ✓ | | ✓ | ✓ | | | | | | | |
| cms: review / publish / archive | ✓ | | ✓ | | | | | | | | |
| report: read / export (sales, GST, COD) | ✓ | ✓ | | | | | | | | | ✓ |
| settings: read | ✓ | ✓ | | | | | | | | | ✓ |
| settings: update | ✓ | ✓ | | | | | | | | | |
| staff: read | ✓ | ✓ | | | | | | | | | |
| staff: manage | ✓ | | | | | | | | | | |
| audit: read | ✓ | ✓ | | | | | | | | | |
| system: read | ✓ | ✓ | | | | | | | | | |
| system: operate | ✓ | | | | | | | | | | |

**Notes**
1. **Operators** are limited to jobs at the stations they are assigned to (`staff_stations`, checked inside the operation). Their job sheets show no prices.
2. **Reports and order fields:**
   - The production, quote and design reports are gated by `production: read`, `quote: read` and `proof: read`.
   - Order amounts reach only roles with `order: read_financials`.
3. **Customers** have no role permissions. Each operation checks they own the record: their own cart, orders, quotes and artwork. Proof and quote links are signed tokens.

---

## 8. Database architecture

### 8.1 Principles (all from Duis)
- PostgreSQL 18 with Drizzle; migrations generated and reviewed.
- **A fresh migration baseline** in the new repository: the drizzle-kit generated SQL plus one hand-written migration. That migration:
  - carries Duis's append-only `REVOKE UPDATE, DELETE, TRUNCATE` statements (audit log, stock movements, order history, order notes, COD remittances, consent records), renamed to `dpw_app`;
  - adds the same for `production_job_events`, and `REVOKE DELETE, TRUNCATE` on `invoices`;
  - creates the slab EXCLUDE constraint. `btree_gist` joins the extensions in `docker/postgres/initdb/02-database.sql`.

  Duis's trigger migrations (stock notify, search index queue) aren't carried over; they belong to the dropped Redis and Elasticsearch features.
- `uuidv7()` IDs.
- Integer paise, protected by CHECK constraints.
- `timestamptz` stored in UTC, shown in IST.
- History rows for every state machine.
- Idempotency keys enforced by UNIQUE constraints.
- Staff changes audited inside the same transaction.
- Jobs queued inside that transaction too (pg-boss `fromDrizzle`).
- Database roles `dpw_owner`, `dpw_app` and `dpw_readonly`.

### 8.2 Reused tables, unchanged or nearly
- **Auth:** `users`, `accounts`, `sessions`, `verifications`, `two_factors`, `rate_limits`, `otp_requests`, `staff_invitations`.
- **Catalogue and stock:** `departments`, `categories`, `attributes`, `attribute_values`, `product_attributes`, `product_attribute_values`, `product_categories`, `product_variants`, `variant_attribute_values`, `product_media`, `product_listing_cache`, `size_charts`, `stock_locations`, `inventory_levels`, `inventory_reservations`, `inventory_movements` (+ reason `reprint`).
- **Merchandising and media:** `collections`, `collection_products`, `discounts`, `discount_targets`, `coupons`, `coupon_redemptions`, `media_assets`, `customer_photos`, `reviews` (−`fit`), `review_photos`.
- **Content:** `cms_pages`, `cms_revisions`, `cms_revision_refs`, `navigation_menus`, `site_settings`, `blog_posts`, `blog_categories`, `blog_tags`, `blog_post_tags`, `blog_authors`, `redirects`.
- **Customers and engagement:** `addresses`, `wishlist_items`, `newsletter_subscribers`, `consent_records`, `contact_messages`.
- **Commerce and shipping:** `carts`, `cart_items`, `order_items`, `order_notes`, `order_status_history`, `order_discounts`, `refunds`, `webhook_events`, `fake_gateway_records`, `shipments`, `shipment_items`, `shipment_tracking_events`, `cod_remittances`, `provider_tokens`, `pincode_serviceability`, `tax_rules`.
- **Operations:** `audit_logs`, `idempotency_keys`, `notification_logs`, `app_rate_limits`, `ops_checks`, `product_sales_stats`.

### 8.3 Changed tables
- **`customer_profiles`** (already one row per user: consents, COD block): add
  - `company_name`;
  - `gstin`, validated by format and checksum in the app;
  - `gstin_state_code`;
  - `billing_address_id` (FK to `addresses`).

  No new table is needed.
- **`products`:** add
  - `decoration_method_id` (FK, NOT NULL; for a kit, the Kit assembly station);
  - `is_kit`;
  - `min_qty`, `qty_step` (CHECK > 0);
  - `quote_only`.
- **`cart_items`, `order_items`:** add `design_id` (FK to `cart_designs` / `order_designs`, NOT NULL).
- **`orders`:**
  - order number prefix `'DPW-'`;
  - new statuses (§6.2);
  - add `quote_id`, `cancel_until`;
  - billing snapshot: company name, GSTIN, billing address, place-of-supply state;
  - **remove the wallet columns** and their CHECK terms.
- **`payments`:**
  - add `quote_id`;
  - CHECK: exactly one of `order_id` or `quote_id`;
  - purposes: `full`, `advance`, `balance` (`exchange_difference` dropped).
- **`refunds`:** add `quote_id` (same rule).
- **`shipments`:**
  - add `eway_bill_number`;
  - directions: `forward` and `replacement` (`reverse` dropped);
  - add `production_job_id` for reprints.
- **`store_settings`:**
  - **remove** the exchange, wallet and promo-credit fields;
  - **add:**
    - invoice and credit-note prefixes;
    - cancellation window (working minutes, default 120);
    - proof reminder days (default `{1,3,7}`);
    - production SLA (working hours);
    - quote validity days (default 15);
    - quote advance (basis points, default 5000 = 50%);
    - artwork maximum bytes;
    - working days and hours;
    - support WhatsApp number.

### 8.4 New tables
| Table | Key columns and constraints |
|---|---|
| `decoration_methods` (stations) | code, name, customer_label, is_active, is_assembly, position |
| `staff_stations` | user_id, decoration_method_id (PK both) |
| `holidays` | date (PK), label |
| `product_print_positions` | product_id, component_id (kits only), code, label, included (bool), addon_paise (≥ 0), max_width_mm, max_height_mm, position; UNIQUE(product_id, code) |
| `product_price_slabs` | product_id, variant_value_id (nullable override), min_qty, max_qty (null = open top), unit_price_paise; **EXCLUDE USING gist** over `int4range(min_qty, max_qty, '[]')` per (product, value), so slabs can't overlap (`btree_gist`) |
| `product_mockups` | product_id, color_value_id (nullable), print_position_id, media_id, area_x / area_y / area_w / area_h (basis points of the image) |
| `product_components` | kit_product_id, position, label, component_product_id, component_variant_id (null when the size comes from the kit's size), color_value_id, quantity_per_kit (> 0), decoration_method_id. A kit's variants carry only its size and have no stock rows of their own |
| `artworks` | user_id (null only for staff uploads to a signed-out quote, until it's accepted), original_key, original_filename, mime, bytes, sha256, preview_key, width_px, height_px, knockout (bool), status (processing / ready / failed), error, rights_confirmed_at, uploaded_by, deleted_at |
| `cart_designs` | cart_id, product_id, color_value_id, positions jsonb `[{positionId, artworkId}]`, note, reorder_of_design_id |
| `order_designs` | order_id, product_id, color_value_id, title snapshot, positions snapshot jsonb (label, addon_paise, artwork_id), note, mockup_key, status, assigned_designer_id, approved_proof_id, revision_count, next_reminder_at, follow_up_due_at |
| `proofs` | order_design_id **or** quote_line_id (CHECK exactly one), version, file_key, preview_key, message, status (sent / approved / changes_requested / superseded), token_hash, token_expires_at, sent_by, sent_at, responded_at, response_note, response_file_key, approval_channel (link / account / staff_recorded / quote_acceptance), approved_by_user_id, approval_ip, approval_user_agent, evidence_key; UNIQUE(order_design_id, version) |
| `production_jobs` | order_id, order_design_id, decoration_method_id, product_component_id, parent_job_id (a kit's assembly job), stage, quantity, assigned_to, due_at, reprint_of_job_id, reprint_reason, started_at, completed_at |
| `production_job_events` | job_id, from_stage, to_stage, actor_user_id, note, created_at |
| `quotes` | number (`DPW-Q-10001`, a sequence), version, supersedes_id, user_id (null until a signed-out request is accepted), contact snapshot, billing snapshot (company, GSTIN, address), status, valid_until, totals (subtotal, discount, shipping, tax, total), advance_bp, advance_paise, advance_paid_at, balance_paid_at, terms, token_hash, created_by, sent_at, accepted_at, converted_at, enquiry_id; CHECKs on totals |
| `quote_lines` | quote_id, product_id (null = custom item), color_value_id, description, hsn_code, tax_rule override, size_breakdown jsonb `{variantId: qty}`, quantity, list_unit_price_paise, unit_price_paise, override_reason, positions jsonb, artwork_id |
| `quote_addresses` | quote_id, label, address snapshot |
| `invoices` | order_id, kind (invoice / credit_note), series, fy, seq, number (UNIQUE(series, fy, seq)), issued_at, seller / buyer snapshots, place_of_supply_state, is_export, lut_reference, lines jsonb (hsn, qty, taxable, rate, cgst, sgst, igst), totals, pdf_key, credit_for_invoice_id, cancelled_at, cancel_reason |
| `invoice_counters` | (series, fy) PK, next_seq. The row is **locked in the issuing transaction**, so numbers have no gaps |

### 8.5 Removed (not copied)
- `exchange_requests`, `exchange_request_photos`
- `wallet_accounts`, `wallet_ledger`, `wallet_credit_lots`, `wallet_lot_usages`
- `stock_alerts`
- `search_index_queue`

### 8.6 Entity relationships
```
users 1─1 customer_profiles (consents, COD block, company + GSTIN) ─0..1 addresses (billing)
users 1─* addresses · 1─* artworks · 1─* carts · 1─* orders · 1─* quotes · 1─* wishlist_items · 1─* reviews
carts 1─* cart_designs 1─* cart_items *─1 product_variants        cart_designs.positions → artworks
decoration_methods 1─* products · 1─* production_jobs · *─* users (staff_stations)
products 1─* product_variants · 1─* product_print_positions · 1─* product_price_slabs · 1─* product_mockups *─1 media_assets
products (kit) 1─* product_components *─1 products / product_variants (the item's blank) · product_components 1─* product_print_positions
orders 1─* order_designs 1─* order_items *─1 product_variants
order_designs 1─* proofs · 1─* production_jobs 1─* production_job_events
production_jobs (kit assembly) 1─* production_jobs (one per item)
orders 1─* payments · 1─* refunds · 1─* shipments 1─* shipment_tracking_events · 1─* invoices · 1─* order_status_history · *─0..1 quotes
quotes 1─* quote_lines 1─0..* proofs · 1─* quote_addresses · 1─* payments · 1─* orders (children, one per address)
inventory_levels (variant × location) 1─* inventory_reservations (order or quote) · inventory_movements
```

---

## 9. API architecture and integrations

### 9.1 Layering (from Duis, enforced by ESLint)
```
app/ (routes)
  → features/<domain>/actions.ts      ('use server': session → operation)
  → features/<domain>/service         (defineOperation: authorise → Zod → transaction, audit, jobs)
  → repository / SQL
  → server/* infrastructure           (db, storage, notifications, jobs)
```
- Domains call each other only through `index.ts`.
- Integrations sit behind interfaces, each with a **fake** used in development and tests:
  - `PaymentGateway`, `ShippingProvider`, the messaging channels;
  - `PrivateStorage`: local and R2.

### 9.2 Server Actions (mutations)
- **New:** `artwork.*`, `proofs.*`, `quotes.*`, `production.*`, `invoices.*`, `customers.saveBusinessDetails`, `cart.reorder`.
- **Reused:** `cart.*`, `checkout.*`, `orders.*`, `customers.*`, `discounts.*`, `cms.*`, `staff.*`, `settings.*`.

### 9.3 Route handlers
| Route | Purpose |
|---|---|
| `POST /api/artwork` | Upload: size and type checks, stream to R2, raster preview (new) |
| `GET /api/artwork/[id]/status` | Preview status, polled by the product page (new) |
| `GET /api/files/[kind]/[id]` | Checks permission, then answers with a 302 to a **5-minute signed R2 URL** (`Content-Disposition: attachment` for originals). Kinds: artwork, preview, mockup, proof, invoice, job sheet, label (new; replaces Duis's private-file route) |
| `/proof/[token]`, `/quotes/[token]` | Pages: signed-link access (new) |
| `POST /api/webhooks/razorpay` · `/logistics` · `/messaging` | Payments, including quote payments; Shiprocket tracking; WhatsApp STOP and delivery receipts (reused) |
| `/api/auth/[...all]`, `/api/health`, `/api/health/ready`, `/api/health/ops`, `/api/internal/revalidate` | Reused |
| `/api/search/suggest`, `/api/serviceability`, `/api/photos` | Reused (search runs on Postgres only) |

### 9.4 Background jobs (pg-boss queues)
- **Reused:**
  - `notify.email`, `notify.whatsapp`
  - `payments.process-webhook`, `payments.reconcile`, `payments.refund`
  - `orders.expire-pending`, `inventory.expire-reservations`, `inventory.low-stock-digest`
  - `shipping.create-shipment`, `shipping.process-tracking`, `shipping.sync-tracking`
  - `cms.publish-scheduled`, `cache.revalidate`, `catalog.refresh-auto-collections`
  - `marketing.cart-reminders`, `reviews.request`, `analytics.meta-purchase`
  - `system.*`
- **New:**
  - `artwork.render` (SVG, PDF and AI previews)
  - `mockups.compose`
  - `proofs.remind` (hourly)
  - `quotes.remind-expiry`, `quotes.expire` (daily)
  - `documents.render` (quote, invoice, credit-note and job-sheet PDFs; the invoice itself is numbered inside the booking transaction)
  - `artwork.purge` (soft-deleted files after 30 days)
- **Dropped:**
  - `alerts.back-in-stock`
  - `wallet.expire-credits`
  - `search.reconcile`

### 9.5 Integrations
| Service | Use | Status |
|---|---|---|
| Razorpay | Orders, checkout, webhooks, refunds, reconciliation; quote advance and balance | Reused; new website, keys and webhook (⚠ check with Razorpay whether this is a new account or a second site on the same business) |
| Shiprocket / Shiprocket X | Serviceability, rates, booking, AWB, label, pickup, tracking, COD remittance; international | Reused; new pickup location (the factory) and webhook token; ⚠ check the e-way bill field; Shiprocket X still unverified in Duis |
| MSG91 | SMS login codes (DLT); WhatsApp templates | Reused adapters; new WhatsApp number, `dpw_*` templates, DLT header and templates |
| SMTP provider | Transactional email | Reused; new sending domain (SPF, DKIM, DMARC) |
| Cloudflare | DNS, proxy, firewall, Turnstile, **R2** (artwork bucket and backup bucket) | New zone, keys and buckets |
| Google OAuth | Sign-in | New client |
| GA4, Meta Pixel and Conversions API | Consent-aware analytics | Reused; new IDs |
| Sentry; UptimeRobot | Errors; uptime | New project and monitor |

---

## 10. Technology stack, with reasons

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16.4.x App Router (Cache Components), React 19.3, TypeScript 5 | Already proven in Duis; one codebase for the storefront, admin and CMS; Server Actions; copied tooling. Pin the same versions; follow AGENTS.md (read the docs in `node_modules/next`) |
| UI | Tailwind 4, shadcn/ui on Base UI, lucide, sonner, dnd-kit, Tiptap | Duis's component kit (35 UI components, admin data table, command palette) restyled with new brand tokens |
| Data | PostgreSQL 18 + Drizzle 0.45 + `pg` | ACID money and stock logic; CHECK and EXCLUDE constraints; full-text search with trigram matching covers a catalogue of about 200 products |
| Auth | Better Auth 1.7 (email, phone OTP, Google, admin, TOTP, captcha) | Built and tested in Duis; staff 2FA |
| Jobs | pg-boss 12 in a separate worker | Jobs queued inside the same transaction, retries, cron, dead letters; no Redis needed |
| Images | sharp 0.35 | Cleans and re-encodes uploads, generates previews and mockup composites; already a dependency |
| **New: object storage** | Cloudflare R2 through **`aws4fetch`** (a small SigV4 signer) | Private artwork and documents, short signed links, no egress fees; far smaller than the AWS SDK |
| **New: PDF and AI previews** | `pdfjs-dist` + `@napi-rs/canvas` (in the worker) | Permissive licences (Apache / MIT); avoids MuPDF and Ghostscript (AGPL). ⚠ check versions on npm when building |
| **New: documents** | `@react-pdf/renderer` (in the worker) | Quote, invoice, credit-note and job-sheet PDFs as React components, with a Noto Sans font so ₹ renders. Replaces Duis's Latin-1-only `lib/pdf.ts` for documents; that file stays for fake labels |
| Validation, logs, errors | Zod 4, pino, Sentry | Duis conventions |
| Email | Nodemailer + React Email, rendered in the worker | Duis rule: never import `react-dom/server` where the web app can reach it |
| Tests | Vitest 5 (unit and integration on real Postgres), Playwright + axe | Duis harness, including race tests and the RBAC snapshot |
| Hosting | Docker Compose: nginx, web, worker, postgres (+ pgBackRest), backup, migrate; behind Cloudflare | Duis ops stack, scaled down to one web container |

**Not added:**
- A canvas library (fabric.js or Konva): comes with the v2 editor.
- ClamAV: §13.
- Redis and Elasticsearch: copy back from Duis when traffic needs them.
- The AWS SDK.

---

## 11. UI/UX: pages and navigation

### 11.1 Look and feel
**Style:**
- Clean, trustworthy and conversion-focused; plenty of white space.
- One confident accent colour.
- Product photos carry the energy.

**Trust signals:**
- "Approve before we print"
- "Made in our own factory"
- "GST invoice on every order"
- Reviews and client logos

**Page patterns:**
- Prices always show per piece and total.
- The mobile product page has a sticky Add / Quote bar.

**Work for the owner (lead-time item):** new logo, palette and type. Brand tokens live in `globals.css`.

### 11.2 Storefront map
```
/                         Home (CMS): hero · how it works · categories · best sellers · joining kits ·
                          quote CTA · reviews · client logos · factory story · FAQ · Journal
/shop/[[...slug]]         /shop/apparel/polo-t-shirts · /shop/gifts/pens …
/collections/[slug]       e.g. joining-kits, best-sellers, under-200
/products/[slug]          Configurator (colour → sizes grid → positions → artwork → preview → slabs → add/quote)
/search                   Postgres search
/quote                    Request a quote (prefilled from ?product=)
/quotes/[token]           View quote · download PDF · accept (sign-in) · pay advance/balance
/proof/[token]            Proof approval
/cart  /checkout  /checkout/success/[orderNumber]
/track                    Lookup + signed tracking link
/account                  Overview · /orders · /orders/[no] (timeline, proofs, invoices, reorder, cancel) ·
                          /quotes · /artwork · /addresses · /business · /wishlist · /reviews · /profile · /security
/login /register /forgot-password /reset-password /verify-email
/journal (+ category/tag/author/post, rss.xml) · /pages/[slug] · /policies/[slug] · /about · /how-it-works · /faq · /contact
```

### 11.3 Navigation
- **Header:**
  - Shop menu: Apparel (T-shirts, Polos, Hoodies, Caps) · Gifts & Merch (Pens, Keychains, Badges, Bottles, Diaries, Desk) · Kits.
  - Links: Bulk orders / Get a quote · How it works.
  - Icons: search, account, wishlist, cart.
- **Mobile bottom bar:** Shop · Quote · Cart · Track · Account.
- **Footer:**
  - Help: track order, FAQ, contact, WhatsApp, phone, hours.
  - Policies: terms, privacy, shipping, cancellation and claims.
  - Company: about, Journal.
  - Social links.
  - Legal: legal name, GSTIN, address, grievance officer.

### 11.4 Main screens
- **Product page:**
  - Left: gallery and mockup, switching between positions.
  - Right:
    - title, rating;
    - "from ₹/pc · Min N";
    - colour, then size grid with stock, then positions;
    - upload area ("PNG, JPG, WebP, SVG, PDF, AI · up to 50 MB"; signed-out visitors sign in first);
    - slab table (current slab highlighted, "add N more to save");
    - live total; note; Add to cart / Request a quote;
    - delivery and dispatch statement.
  - Tabs: details, print method and area, size chart, reviews, FAQ.
  - A kit lists its items, each with its print method and positions; one logo fills every position by default.
- **Checkout** (one page with steps): address → business details (optional, GSTIN) → payment mode → review → pay.
- **Proof page:**
  - Proof image or PDF, with version history.
  - Mockup and print details.
  - Checklist, then Approve or Request changes.
- **Order page (account):** a progress bar, then one card per design (mockup, proof status, action), then shipment and invoices, then cancel (with countdown) and reorder.
- **Admin sidebar groups:**
  - Sell: Dashboard, Orders, Quotes, Customers, Messages.
  - Make: Design, Production, Shipments, Inventory.
  - Catalogue: Products, Categories, Attributes, Size charts, Stations, Collections, Discounts.
  - Content: CMS, Media, Journal, Redirects, Reviews.
  - Money: Invoices, Reports.
  - Admin: Staff, Settings, Audit, System.

  The sidebar is filtered by permission (reused).

---

## 12. Payment, shipping and notification architecture

### 12.1 Payments (Razorpay, behind `PaymentGateway`)
- **Prepaid order:**
  1. The server recomputes the price quote and checks its hash.
  2. It creates a Razorpay order, and the browser opens Checkout.js.
  3. The callback's signature is verified and the payment fetched from the server.
  4. The webhook, checked by HMAC on the raw body and deduplicated in `webhook_events`, runs `confirmOrder` (idempotent).
  5. `payments.reconcile` catches any payment whose callback never arrived.

  All reused.
- **Partial COD:**
  - The advance (fixed or percentage) is paid online (`advance`). The rest is collected by the courier, plus the COD fee.
  - The order cap, PIN-code serviceability and customer COD block are checked.
  - The COD remittance CSV import marks the balance paid.
  - On RTO, the setting decides: keep or refund the advance.

  All reused.
- **Quote advance and balance:** payments carry `quote_id` with purpose `advance` or `balance`. They use the same webhook and reconciliation path.
  - The advance moves the quote to `advance_paid`.
  - The balance unblocks dispatch.
- **Refunds:** to the original payment method only, through the `payments.refund` job, idempotent. Each refund issues a credit note if an invoice already exists.

### 12.2 Shipping (`ShippingProvider`: Shiprocket, plus a fake)
- **Checkout:** serviceability and COD flag by PIN code; live rate by parcel weight (sum of piece weights).
  - Free shipping at or above the threshold.
  - International: live rate, prepaid only.
- **Fulfilment:**
  - Issue the tax invoice first (the e-way bill needs its number).
  - Create the order, assign the AWB, fetch the label (stored privately), request pickup.
  - Cancel before pickup if needed.
  - The e-way bill number goes on shipments worth more than ₹50,000.
- **Tracking:** the logistics webhook (token, deduplicated, status never moves backwards), with polling as a fallback. Customer timeline and messages; RTO handling (stock returns are manual for custom goods).
- **Reprint:** a `replacement` shipment.
- **Quote with several addresses:** one order, and so one shipment, per address.

### 12.3 Notifications
- **Template registry:** `src/server/notifications/templates.ts`. Emails are React Email components rendered in the worker; WhatsApp templates are named `dpw_*`.
- **Delivery log:** every send writes to `notification_logs`.
- **Retries and failures:** retries with backoff, and dead letters.
- **Opt-out:** marketing messages wait for quiet hours (21:00–09:00); STOP replies are honoured.
- **Proof messages** carry a signed approval link. **Reminders** run as jobs with their timing stored on the design (`next_reminder_at`), so they survive restarts.

---

## 13. Security and scalability

### 13.1 Security
**Reused from Duis**
- **Edge and origin:**
  - Cloudflare proxy, with the server firewall accepting only Cloudflare IP ranges.
  - Origin certificate; HSTS; CSP and the other security headers.
- **Sign-in:**
  - Turnstile on sign-in and public forms.
  - Limits on login codes per phone number and per IP.
  - Staff TOTP 2FA, enforced at the admin layout and in every operation.
- **Authorisation:** authorisation runs first in every operation, and the RBAC matrix test covers every operation.
- **Data integrity:**
  - Zod validation at every boundary.
  - Idempotency keys; price-quote hash checks against tampering.
  - Signed internal calls (HMAC); token hashes only in the database.
  - The audit log.
  - Rate limits shared across app copies.
- **Infrastructure:**
  - Secrets in environment variables, validated at startup; no database at build time.
  - Containers run as non-root, read-only.

**New, for artwork**
- **Accepting files:**
  - Allow-list checked by the file's first bytes (magic bytes), whatever its name says.
  - 50 MB limit in the app, and Nginx `client_max_body_size 55m` on `/api/artwork` only.
  - Each user has a daily upload quota.
- **SVG and PDF:**
  - SVG is never served as SVG; it is rasterised.
  - SVGs with `<script>`, `foreignObject` or external `href` are refused.
  - PDF and AI rendering runs in the worker with a time limit and page 1 only.
- **Serving files:**
  - The R2 bucket is private, and its keys are held only on the server.
  - Files come only from `/api/files/*` after a permission check, as 5-minute signed links.
  - Originals are sent with `Content-Disposition: attachment`.
- **Other controls:**
  - The rights confirmation is recorded with each upload.
  - Approval evidence: IP address and browser, for disputes. This is stated in the privacy policy.
- **Malware:** no ClamAV at launch (it would take about 1.5 GB of RAM on a lean server). The controls are:
  - the type allow-list;
  - renders that never execute file content;
  - staff opening originals only on machines with up-to-date antivirus.

  Upgrade path: add a ClamAV sidecar if staff ever open originals on unmanaged machines.

### 13.2 Data protection and retention (DPDP)
- **Consent:** consent records and marketing opt-in (reused).
- **Account deletion** removes:
  - personal data;
  - artwork that no open order uses.

  It keeps orders, invoices and payment records for **8 years** (GST).
- **Artwork kept for reorders:** for as long as the account exists; deleted copies are purged 30 days after soft deletion.
- **Proof links:** expire after 30 days.

### 13.3 Scalability
**Launch:**
- Server: 4 vCPU / 8 GB.
- One web container, the worker, Postgres (about 2 GB `shared_buffers`) and Nginx (static files and `/media` caching).
- Heavy work (previews, mockups, PDFs) runs only in the worker, with limits on how many jobs run at once, so the web stays fast.
- R2 holds the large files, so the disk only grows with the database and media.

**When to grow** (each step is already proven in Duis):
1. Uploads approach the app memory limits → switch to **presigned direct-to-R2 uploads**.
2. More traffic → **2nd web replica** + rolling deploy (Duis ADR-017).
3. Catalogue reads load the database → **Redis cache handler** (Duis ADR-033).
4. Search gets slow, or the catalogue passes about 5,000 products → **Elasticsearch**.
5. Peaks → the 10-second **Nginx page cache**.

---

## 14. Development phases and milestones

Sizes are in person-weeks for one senior full-stack engineer; Duis's own build pace (AI-assisted) compresses them a lot in calendar time. Each phase ends with:
- its exit check passing;
- `npm run check` and the integration suite passing;
- end-to-end tests passing, where behaviour changed;
- a review stop with the owner.

| Phase | Scope | Exit check | Size |
|---|---|---|---|
| **P0 Repository bootstrap** | New repo; copy the B.2 manifest from a pinned Duis commit; brand rename (`duis` → `dpw`, plus a CI check that fails on the word "duis"); remove the C list (wallet, exchanges, alerts, Elasticsearch, Redis, ImageKit, fashion seed); fresh migration baseline; auth schema regenerated; seed skeleton; CI green; Docker image builds | `npm run check`, integration and end-to-end smoke tests green on an empty catalogue; image runs non-root | 2–3 |
| **P1 Platform adaptation** | 11 roles and the permission matrix; settings (business hours, holidays, invoice series, proof, quote and production defaults); R2 private storage with the local fake (versitygw, already in the Duis local Compose file); `/api/files`; template registry skeleton; brand tokens and design-system v0 | RBAC matrix snapshot reviewed; R2 integration tests pass; working-hours unit tests pass | 3–4 |
| **P2 Print catalogue** | Stations; product fields (method, MOQ, step, quote-only); positions; slabs (EXCLUDE constraint); mockup-template editor; kit components, and kit availability from component stock; admin product tabs; storefront listing cards and product page (slab table, size grid, positions, without upload); demo catalogue seed (tees, polos, hoodies, caps, pens, keychains, badges, bottles, diaries, kits) | The product page shows a correct live total for any colour and size mix; overlapping slabs are refused by the database; a kit shows how many complete kits its component stock allows | 4.5–6 |
| **P3 Artwork, cart and checkout** | Artwork upload, render jobs and library; instant mockup on the product page; `cart_designs`; slab pricing in the engine (pure, unit-tested) plus MOQ, step and quote-required issues; GSTIN and business details; checkout (prepaid, partial COD, international); order designs; per-size and per-item (kit) reservations; mockup composites | **M1:** a customer configures, uploads, previews and pays a test order (fake and test Razorpay) with the correct slab price, add-ons, GST and shipping; last-unit race test passes | 6.5–9 |
| **P4 Proofing and approvals** | Design workspace; proof versions; signed-link proof page; approve or request changes; staff-recorded approvals; reminders and follow-up; `cancel_until` and self-service cancellation; order status driven by designs; email and WhatsApp templates | **M2:** proof approved from an email or WhatsApp link; paid unapproved orders never expire; cancellation window enforced (holiday-aware) | 4–5 |
| **P5 Production and fulfilment** | Station routing; production board; stages; QC rework; reprints; kit item jobs and the assembly job; job-sheet PDF (`@react-pdf`); ready-to-dispatch → Shiprocket booking (reused); production progress in the account; e-way bill field | An approved order moves through the stations and ships with the fake courier; a kit's assembly job starts only when all its item jobs are ready; an operator sees only their station and no prices | 4.5–5.5 |
| **P6 Invoicing** | Invoice at booking; gap-free series per financial year; place of supply (A20); export under LUT; credit notes; cancel and re-issue; PDFs; account downloads; invoice register; GST export in the Duis layout; **CA sign-off on A4, A13, A20, A21, A25** | **M3:** invoice and credit-note totals match orders and refunds; numbering race test passes; CA approves the sample invoices | 3–4 |
| **P7 Quotes** | Request form and enquiries; quote builder (custom lines, overrides, versions); quote PDF and link; accept; advance and balance payments; convert into orders per address with allocation; dispatch gating; reminders and expiry | **M4:** enquiry → quote → accept → advance → 2 orders → balance → dispatch, end to end | 4–6 |
| **P8 Account extras, content and reports** | Reorder (A22); artwork library management; reviews, coupons, newsletter, abandoned cart and Journal configured; new CMS blocks; SEO; production, quote, design and accounts reports; dashboards | Every Definition-of-Done scenario (§15.2) passes against the fakes | 3–5 |
| **P9 Launch** | VPS bootstrap, Cloudflare, R2 buckets, backups and restore drill, Sentry, UptimeRobot; live Razorpay, Shiprocket and MSG91; DLT and WhatsApp templates; SMTP domain; smoke and security checks (headers, nmap, Trivy); owner acceptance testing; go-live runbook | **M5:** live behind Cloudflare; one real test order, shipment, invoice and quote; restore drill passes | 2–4 |
| | | **Total** | **≈ 37–52** |

**Lead-time items for the owner (start on day 1):**
- **Accounts and infrastructure:** domain and Cloudflare zone; VPS; R2 buckets.
- **Payments and delivery:** the Razorpay website or account; Shiprocket pickup location (factory address).
- **Messaging:** MSG91 WhatsApp number and template approvals; DLT header and templates; SMTP sending domain; Google OAuth client.
- **Analytics and monitoring:** GA4 and Meta IDs; Sentry.
- **Tax:** LUT for financial year 2026-27; CA review of the GST assumptions.
- **Brand and content:** brand identity; legal pages (terms with the artwork rights clause, cancellation and claims, shipping, privacy).
- **Product data:** blanks, colours and sizes; **photos per colour and side, with print areas**; slabs, MOQs and steps; HSN codes; weights; opening stock.

---

## 15. Testing and deployment

### 15.1 Tests (Duis harness; the owner's rule: `npm run check` always, plus integration and end-to-end tests when behaviour changes)
- **Unit tests (pure functions):**
  - slab resolution, MOQ and step;
  - add-ons, and the GST per-piece threshold after discount;
  - partial COD;
  - quote allocation;
  - GSTIN checksum;
  - adding working minutes (business hours, holidays);
  - place of supply and the tax split;
  - invoice number format.
- **Integration tests (real Postgres, fake Razorpay, Shiprocket and R2):**
  - RBAC matrix: every operation × 12 roles, plus anonymous and missing-2FA cases.
  - Checkout with slabs, and per-size reservations including a last-unit race.
  - Paid orders awaiting a proof never expire.
  - The proof state machine and reminders.
  - The cancellation window.
  - Artwork validation: magic bytes, size, SVG with scripts, broken PDFs.
  - Quote → payments → conversion → balance gating.
  - Gap-free invoice numbering under concurrency.
  - Credit notes; reprints; operators limited to their own station.
  - Kits: availability from component stock, per-item reservations, and the assembly job waiting for its items.
- **End-to-end tests (Playwright, desktop and mobile, axe on key pages):**
  - customer instant order → proof by link → production → dispatch → invoice;
  - quote journey;
  - staff role journeys;
  - the consent check (no trackers before consent).
- **Before launch:**
  - Lighthouse mobile ≥ 90;
  - k6 smoke load test (browse, product page, upload);
  - Trivy image scan; nmap; header checks on the live domain.

### 15.2 Definition of done (end to end on the production-like stack)
1. **Customer:**
   - browses, configures a polo (2 colours, a size mix, front + back), uploads a PDF logo and sees the mockup;
   - signs in by OTP, adds a GSTIN, pays (partial COD);
   - approves the proof from the WhatsApp link;
   - watches the production progress; receives the parcel; downloads the GST invoice;
   - reorders in one click.
2. **Quote:**
   - an HR buyer requests 300 joining kits for 2 addresses;
   - Sales send a quote with a price override and a mockup;
   - the buyer accepts and pays 50%;
   - Sales convert it into 2 orders; each kit's items are printed at their own stations, then assembled;
   - the balance is paid, and both orders ship and are invoiced.
3. **Staff:**
   - the designer gets changes requested, then sends v2, which is approved;
   - Production routes the job to DTF, an operator moves it through the stages, QC sends it back once, then it's packed;
   - Fulfilment books the shipment; Accounts issues a credit note for a partial refund;
   - the audit log shows every step.

   A Content Editor and a Production Operator are refused on direct calls they aren't allowed to make.
4. **Deployment:**
   - the stack runs on the VPS behind Cloudflare and survives restarts;
   - a deploy and a rollback work;
   - a backup is restored onto a fresh server by following the runbook.

### 15.3 Deployment
- **CI:** GitHub Actions runs lint, typecheck, format, unit tests, integration tests (Postgres service), build, Docker build and end-to-end tests. `main` is protected.
- **Environments:**
  - local `compose.dev` (Postgres, Mailpit, versitygw S3);
  - the local production-like stack (`compose.local`) for rehearsals;
  - production on the VPS.
- **Deploy:**
  - `ops/deploy.sh` builds on the server, tagged by git SHA, then runs migrations.
  - It replaces the web container (a few seconds' interruption, A17) and the worker, then runs the smoke test.
  - `ops/rollback.sh` switches back to the previous image.
- **Backups:**
  - pgBackRest point-in-time recovery, plus a nightly logical dump, both to the R2 backup bucket.
  - restic for the media volume.
  - Artwork lives in R2 and is soft-deleted only.
  - A monthly restore drill.
- **Monitoring:** Sentry; UptimeRobot on `/api/health`; `/api/health/ops` and the ops-check job send alert emails (reused).

---

## 16. Challenges, dependencies and risks

| Risk | Impact | Mitigation |
|---|---|---|
| Designers become the bottleneck (free, unlimited revisions) | Slow dispatch, unhappy customers | Workload and turnaround reports; reminders; follow-up queue; revision count visible; policy wording; reorders skip the proof when nothing changed (A22) |
| The mockup doesn't match the printed result | Disputes | Calibrated print areas per colour photo; ±5 mm and colour disclaimers; the **designer's proof** is what's approved, not the instant mockup |
| PDF and AI edge cases (AI not saved as PDF-compatible, CMYK, very large files) | Missing previews | Worker time limit, then "preview after design"; the designer always gets the original |
| Malicious or oversized files | Security, cost | Type allow-list, rasterising, private bucket, signed attachments, quotas (§13) |
| GST complexity (bill-to-ship-to place of supply, composite supply, kits as a mixed supply, credit notes, LUT, e-way bill) | Compliance | **CA sign-off before P6**; reuse the Duis tax engine; unit and integration tests; Accounts role |
| Same GSTIN as Duis | One GSTR-1; e-invoicing threshold is combined | Separate invoice series; the Duis CSV layout; the owner watches combined turnover (e-invoicing becomes due at ₹5 cr) |
| Vendor lead times (WhatsApp templates, DLT, Razorpay site approval, Shiprocket) | Launch delay | Start on day 1; build against fakes; production refuses fakes (Duis env checks) |
| Leftover Duis branding and fashion assumptions | Bugs, confusion | Rename pass; CI check against the word "duis"; prune module by module with the test suites green |
| 2-working-hour cancellation disputes | Support load | Deadline stored at payment; countdown in the UI; holidays calendar; staff can always override |
| Partial COD on made-to-order goods (refusals) | RTO losses | Advance, order cap, COD fee, customer COD block, RTO advance policy (all reused) |
| Single VPS | Outage | Backups, restore drill, runbooks; the scale path in §13.3 |
| Uploads buffered in app memory | Memory pressure | One upload at a time per user, 50 MB cap; upgrade path: presigned direct-to-R2 uploads if it ever matters |
| Kits (component stock, assembly) | Wrong availability; kits stuck waiting for assembly | Availability and reservations computed in one place (`inventory` service) from component stock; one gating rule for assembly; integration tests |
| Next.js 16 specifics (Cache Components, `connection()`, `proxy.ts`) | Build and run-time surprises | Pin Duis's versions; follow AGENTS.md; no database at build time |
| Scope creep (editor, names list, B2B teams) | Delay | Roadmap (§17); review stop after each phase |

**What the build depends on:**
- **Owner:** brand assets; product data and mockup photos; legal content; vendor accounts; business hours and holidays.
- **CA:** confirmations of A4, A13, A20, A21 and A25.
- **Vendors:** template approvals; Razorpay and Shiprocket setup.

**Assumptions still to confirm** (defaults are built unless the owner says otherwise) are listed in **[Appendix C.2](appendix-c-requirements-register.md)**: A1–A26.

---

## 17. Future enhancements, in order
1. **Live design editor** (customiser phase 2): a canvas (fabric.js or Konva, chosen then) to drag, resize and rotate logos and text per position, with Indic fonts. It writes the same `positions` JSON, so orders and proofs don't change.
2. **Names list per piece:** a CSV or pasted list (name, designation) for each design, shown on the proof and the job sheet.
3. **Company teams and credit:**
   - several buyers per company, with PO numbers and approval chains;
   - credit terms and invoice-based payment (receivables, credit limits);
   - contract price lists.
4. More product families: paper and stationery (a specification configurator), and large format (priced per square foot).
5. Express production at checkout; a per-product production time; estimated delivery date by PIN code.
6. An in-app claim form with photo and video upload.
7. Reseller and wholesale price tiers; recurring or scheduled corporate orders.
8. Scale components (§13.3); e-invoicing (IRN) once combined turnover passes ₹5 cr; a public API; a Hindi interface.

---

## Critical files (new repository; paths follow the Duis layout)
- **Unchanged, reused as is:**
  - `src/server/operation.ts`, `src/server/db/transaction.ts`, `src/server/jobs/enqueue.ts`, `src/server/audit.ts`, `src/server/security/tokens.ts`;
  - `src/features/payments/gateway.ts`, `src/features/shipping/provider.ts`;
  - `src/components/admin/data-table.tsx`.
- **Modified:**
  - `src/server/auth/roles.ts`, `src/server/auth/permissions.ts`;
  - `src/features/pricing/engine.ts` (slab-resolved lines and add-ons; wallet removed);
  - `src/features/checkout/service.ts`, `src/features/orders/lifecycle.ts`, `src/features/orders/admin.ts`, `src/features/cart/service.ts`;
  - `src/features/inventory/service.ts` (kit availability, per-item reservations), `src/features/catalog/admin.ts` (slabs, positions, mockups, kit components), `src/app/(storefront)/products/[slug]/page.tsx` (configurator; stock read without Redis);
  - `src/db/schema/{catalog,orders,payments,shipping,settings,customers,cart}.ts`;
  - `src/server/storage/private.ts` (moves to R2), `src/server/jobs/queues.ts`, `src/worker/handlers.ts`;
  - `src/server/notifications/templates.ts`, `src/server/notifications/whatsapp.ts`;
  - `next.config.ts`, `scripts/build-server-bundles.mjs`, `compose.yaml`, `ops/deploy.sh`, `docker/nginx/nginx.conf`.
- **New:**
  - `src/features/{artwork,mockups,proofs,production,quotes,invoices,documents}/`;
  - `src/lib/{gstin,working-hours,slabs}.ts`;
  - `src/server/storage/r2.ts`;
  - `src/app/api/artwork/route.ts`, `src/app/api/files/[kind]/[id]/route.ts`;
  - `src/app/(storefront)/{quote,quotes/[token],proof/[token]}`;
  - `src/app/admin/{designs,quotes,production,invoices,stations}`.
- **Docs:** this plan becomes the new repository's `doc/` set (requirements, architecture, flows, database, phases, deployment, security, testing, permissions, ADRs), following the Duis conventions in AGENTS.md.

## Verification
- **After every phase:**
  - `npm run check` (lint, typecheck, format, unit tests);
  - `npm run test:integration` (real Postgres, fakes for Razorpay, Shiprocket, MSG91 and R2);
  - `npm run test:e2e` when behaviour changed;
  - the phase's own exit check (§14).
- **Before launch:**
  - the four Definition-of-Done scenarios (§15.2) on the production-like local stack (`compose.local.yaml`: Nginx, web, worker, Postgres, versitygw S3, Mailpit);
  - axe and Lighthouse on key templates;
  - the RBAC snapshot reviewed against §7;
  - CA sign-off on sample invoices (B2C intra-state, B2B inter-state with bill-to-ship-to, export under LUT, a kit, credit note).
- **At go-live (on the VPS):**
  - one real Razorpay payment, one Shiprocket shipment (then cancelled) and one WhatsApp proof link;
  - the restore drill;
  - header and port scans.
- **No Duis-store application code changes at any point.** Copies are taken from a pinned commit into the new repository.

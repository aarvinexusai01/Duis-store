# ADR-0024: Phase 4c settings, staff, system and reports decisions

- Status: Accepted
- Date: 2026-10-16
- Deciders: On 2026-10-16 the owner chose:
  - **staff join by email invitation;**
  - **notification settings** cover on/off and the sender only;
  - **a daily low-stock email** goes to Store and Super Admins;
  - **all three moved items** are built: command palette, CSV export of lists, column visibility.

## Context

Slice 4c finishes the admin portal: the settings the business changes without a deploy, staff management with an audit trail, a view of background jobs, and the reports the accountant needs.

## Decisions

### Settings

**Decision.**
- Settings save one section at a time: legal, shipping, COD, policies and emails.
- Each change is audited with before and after values.
- Changes apply to new orders only; placed orders keep their snapshot.
- Sections customers see refresh the storefront through the `store:settings` cache tag.
- The product page and the bag now read the free-shipping threshold, COD and exchange values from settings. They used to use constants in `config/store-policy.ts`, which could disagree with checkout.
- Provider keys stay in the environment. The settings page shows which providers are live, in test mode or demo, and has a "test connection" button per provider.

**Why.**
- The owner can change policy values without a release.
- Secrets never pass through the admin.
- One source of truth stops the product page promising free shipping that checkout then charges for.

### Tax rules

**Decision.**
- A new GST rule starts on a date and ends the current rule for that HSN prefix the day before.
- Overlapping or backdated rules are refused.
- Rules take effect by the **IST** date; they used the database's UTC date before.

**Why.** Past orders keep the tax they were charged, and a rate change happens exactly at midnight in India.

### Email

**Decision.**
- Staff can turn off three emails: order shipped, payment not completed, and the low-stock digest.
- Staff set the sender name and reply-to address.
- Confirmations, cancellations, refunds and account emails can't be turned off.
- The sending address stays `SMTP_FROM`, because the mail server is authorised for it.
- The wording stays in code.

**Why.** It's the owner's choice, and it keeps legal and transactional text from being broken by an edit.

### Staff onboarding

**Decision.**
- A Super Admin invites an email address with roles.
- The link works once, for 72 hours; only a hash of the token is stored.
- Someone new chooses a name and password. The account is created verified (the link proved the address) and signed in, then two-factor setup follows.
- Someone with an account already signs in first and keeps their password.
- A new invitation to the same address replaces the old one.

**Why.** Nobody else ever knows a staff password, and staff permissions still require 2FA (ADR-019).

### Staff safety

**Decision.**
- Roles can be changed.
- 2FA can be reset (for a lost phone), which ends all of that person's sessions.
- Accounts can be deactivated (a ban that also ends sessions).
- The store must always keep another active Super Admin with 2FA. Nobody can deactivate themselves or reset their own 2FA.

**Why.** The store can't lock itself out of staff management.

### System page

**Decision.**
- The page shows queue counts from pg-boss, failed jobs (retry or discard), the last 50 webhooks (with "run again") and the worker heartbeat.
- Job data is summarised (ids, template, a masked email address), never shown whole.

**Why.** Job payloads can hold email links and addresses.

### Refunds use the paying gateway

**Decision.** A refund goes through the gateway that took the payment, not the current `PAYMENT_PROVIDER`.

**Why.** Refunds for test orders paid with the fake gateway were retrying forever against Razorpay after `.env` switched to it. This was found while building the system page.

### Reports

**Decision.**
- Sales count from the day payment was confirmed (IST). Cancelled and unpaid orders are not sales.
- The report shows totals, sales by day, sales by main category, refunds and COD.
- The **GST CSV** has one row per order line, plus one "Shipping and COD charges" row (SAC 9968, for the CA to confirm). An order's rows add up to its total, and a test checks this.
- All CSVs:
  - defuse spreadsheet formulas (a leading `= + - @` becomes text);
  - start with a byte-order mark so Excel reads ₹ and names correctly.

**Why.** It's the owner's choice of a generic export. The total check means nothing is lost between the order and the accountant.

### List exports

**Decision.** Exports page through the same list operations as the screens.

**Why.** Filters, permissions and hidden money columns stay identical between the screen and the file.

### Column visibility

**Decision.** Hidden columns are a style rule on `data-col` cells, remembered per browser in local storage.

**Why.** The tables stay server-rendered and work without JavaScript. The choice is a per-person convenience, which is the only thing browser storage is used for.

### Command palette

**Decision.** Ctrl/⌘+K searches pages and, through `staff.search`, orders, products, customers and discounts, each only for roles that can read them.

**Why.** It's fast navigation that never reveals what a role can't open.

### RBAC coverage

**Decision.** The RBAC matrix test now fails if a feature module that defines operations isn't imported by it.

**Why.** The settings, staff and system operations were missing from the matrix until this guard found them.

## Consequences

- Phase 4 is functionally complete.
- The exit criteria still waiting on the owner:
  - one real Shiprocket test shipment (doc/10 A5);
  - the Razorpay test-mode payment (Phase 3).
- The CA should confirm the GST CSV fields and the courier SAC code (doc/10 A14).

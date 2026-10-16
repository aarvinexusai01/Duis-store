# ADR-0022: Phase 4a admin shell, catalogue and inventory decisions

- Status: Accepted
- Date: 2026-10-16
- Deciders: On 2026-10-16 the owner chose:
  - to deliver Phase 4 in three slices (4a, 4b, 4c), with a review stop after each;
  - for shipping, a fake provider plus a real client that stays unverified until the courier accounts exist;
  - for GST, a generic CSV export, because the external tool isn't chosen yet.

## Context

Slice 4a is the part of Phase 4 that runs the catalogue: the admin shell, staff 2FA enrolment, the dashboard, products, categories, attributes, size charts, collections and inventory. Orders, shipping, customers and discounts come in 4b. Settings, staff, the system page and reports come in 4c.

## Decisions

### Admin access

**Decision.**
- Every `/admin` page first calls `requireStaff()`:
  - anyone who isn't staff gets a 404;
  - staff without 2FA are sent to `/admin/two-factor`.
- The sidebar and buttons are filtered with `can(actor, permission)`. A page the role can't use shows a "no access" notice.
- Hiding is only for convenience. Every read and write is still a `defineOperation`, which authorizes and audits.

**Why.**
- A 404 doesn't confirm to strangers that an admin exists.
- The real check stays on the server, so a direct call to a Server Action is refused too. The Content Editor end-to-end test checks both.

### 2FA enrolment

**Decision.** The enrolment flow is:
1. Confirm the password.
2. Scan a QR code, which the `qrcode` package draws in the browser. The key is also shown as text.
3. Verify a TOTP code.
4. Save the backup codes, which are shown once.

**Why.** The TOTP secret is never sent to an outside QR service.

### Tables

**Decision.** Lists are server-rendered tables. Search, filters and the page number live in the URL (GET forms). Bulk actions post the selected ids to a Server Action. A page shows 50 rows.

**Why.**
- No client table library is needed.
- Links can be shared.
- The browser's back button works.
- It works before JavaScript loads.

### Rich text

**Decision.**
- Product descriptions use Tiptap 3.31.4.
- The editor is limited to what the storefront sanitizer allows: headings 2–4, bold, italic, underline, strike, lists, quotes, rules, and links (http, https and mailto only).
- There are no code blocks, and `immediatelyRender: false` avoids a hydration mismatch.

**Why.** What staff see in the editor is what customers see, and nothing the sanitizer would strip can be entered. 3.31.4 is the newest version at least two weeks old (3.32.0 was three days old).

### Variants and stock

**Decision.**
- The generator creates only the colour × size combinations that are missing, and keeps existing variants.
- The grid edits SKU, price, MRP and status. Bulk fill sets price and MRP on every row.
- Stock changes only through a dialog (received, damaged or lost, other correction, physical count), and each change is a recorded movement with the staff member's name.
- A physical count is a `count_correction` movement. It is refused below the reserved quantity.

**Why.** Stock is never overwritten without a trail, and a count can't take away units held for orders awaiting payment.

### Category order

**Decision.** Categories are reordered with up and down buttons and moved with a parent selector. There is no drag-and-drop.

**Why.** Buttons work from the keyboard and on phones, and each click is one audited move. Drag-and-drop can be added later if the tree grows.

### Collection preview

**Decision.** The rule preview count uses the same SQL condition (`ruleCondition`) as the collection refresh job.

**Why.** The preview can't disagree with what gets published. A test checks that the preview and the refresh return the same products.

### Dashboard

**Decision.**
- Revenue, average order value, COD to collect and best sellers need `order: read_financials`.
- Fulfilment and Support staff see the operations figures (to fulfil, awaiting payment, low stock, recent orders) without amounts.
- Revenue counts placed orders, net of cancellations, by day in IST.

**Why.** Packing staff need the backlog, not the takings (doc/permissions.md).

## Moved to later slices

| Item | Moves to |
|---|---|
| Command palette | 4c |
| Column visibility | 4c |
| CSV export | 4c, with reports |
| Daily low-stock email | 4c, with notification settings. The dashboard and inventory filter show low stock now. |

## Consequences

- Any new admin page must call `requireStaff()` and use operations. The RBAC matrix test lists every new operation automatically.
- End-to-end tests sign staff in with a generated TOTP code, so 2FA is tested on every run.

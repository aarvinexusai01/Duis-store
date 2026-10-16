# ADR-0026: Phase 5b messaging, OTP limits, back-in-stock and bag reminders

- Status: Accepted
- Date: 2026-10-16
- Deciders: On 2026-10-16 the owner chose:
  - **MSG91** for SMS and WhatsApp;
  - **WhatsApp opt-in** by an unticked box at checkout plus an account switch, and a STOP reply turns it off;
  - **WhatsApp messages:** order updates, exchange steps and back-in-stock alerts, but no promotions or bag reminders;
  - **quiet hours** from 21:00 to 09:00 IST, except for order and exchange updates;
  - **Turnstile** on login codes, switched on once its keys are set.

## Decisions

### Login-code limits

**Decision.**
- Before Better Auth sends a code, a hook checks:
  - per phone: a 30-second cooldown, 5 an hour and 10 a day;
  - per IP: 20 an hour.
- Only a hash of the number is stored, for one day.
- Cloudflare Turnstile protects sending a code, sign-up and password reset once `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set.
- The CAPTCHA plugin is always registered (a conditional plugin breaks Better Auth's inferred session type). Without keys it guards a path that never exists, because an empty list falls back to its defaults, which include email sign-in.

**Why.**
- SMS pumping costs money per message.
- The per-phone limits hold even where Better Auth's per-IP limiter is off (tests) or shared (offices, mobile networks).

### MSG91 adapters

**Decision.**
- `SMS_PROVIDER=msg91` uses MSG91's OTP API with our own code and the DLT template.
- `WHATSAPP_PROVIDER=msg91` sends Meta-approved templates through MSG91.
- Both are written from MSG91's documentation and are **unverified** until the account and approvals exist (doc/10 A2, A3).
- Production refuses the fakes. WhatsApp may be `off`.

**Why.** It's the owner's choice of one provider for both. Development and tests stay deterministic.

### WhatsApp templates

**Decision.**
- Each message is a named template with numbered placeholders: `duis_order_confirmed`, `duis_order_shipped`, `duis_out_for_delivery`, `duis_order_delivered`, `duis_exchange_update` and `duis_back_in_stock`.
- A message is queued only when the customer opted in. It is sent by a `notify.whatsapp` job and logged like email.
- Back-in-stock messages wait for 09:00 IST.
- Email is always sent as well; WhatsApp is extra.

**Why.**
- WhatsApp requires approved templates and opt-in for business-initiated messages.
- Sending email as well means nobody misses an update if WhatsApp fails.

### Opt-out

**Decision.** An inbound "STOP" (MSG91 webhook at `/api/webhooks/messaging`, shared token) clears both WhatsApp consents for that number. Customers can also use the account switch.

**Why.** WhatsApp policy and DPDP: consent is easy to withdraw.

### Back-in-stock

**Decision.**
- Sold-out sizes are now selectable on the product page, showing "Notify me" instead of "Buy now". Sizes that don't exist stay disabled.
- Any stock change queues a send for sizes with people waiting. The job checks that the size really is available, emails in batches of 200 and marks each alert done.
- Each alert is sent once and then ends, so there is nothing to unsubscribe from.
- The form gives the same answer whether or not an alert already existed, and is rate-limited per IP.

**Why.** No silent re-alerts, and no way to learn whether someone else asked.

### Bag reminders

**Decision.**
- These go only to signed-in customers with marketing email consent.
- One email after an hour idle and one after a day, never more. New activity starts a fresh cycle.
- No reminder if they ordered since.
- A signed one-click unsubscribe link opens a page with a button, so mail scanners can't unsubscribe people by opening the link.

**Why.** It's the owner's policy (doc/10 P15). Consent and withdrawal are explicit.

## Consequences

- **SMS:** register the DLT sender and OTP template with MSG91, then set the `SMS_*` values (doc/10 A2).
- **WhatsApp:** get the six templates approved with exactly these names and placeholder orders, then set the `WHATSAPP_*` values and the inbound webhook (doc/10 A3).
- **Turnstile:** create a site in Cloudflare and set its two keys (doc/10 A10).

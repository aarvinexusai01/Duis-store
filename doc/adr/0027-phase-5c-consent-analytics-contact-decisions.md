# ADR-0027: Phase 5c cookie consent, analytics and the contact form

- Status: Accepted
- Date: 2026-10-16
- Deciders: On 2026-10-16 the owner chose:
  - **Contact messages** go to an admin inbox and are emailed to the team, with reply-to set to the customer.
  - **The consent banner** has "Accept all", "Reject all" and "Choose", equally visible. "Choose" offers separate Analytics and Marketing switches.

## Decisions

### Consent banner and records

**Decision.**
- Only essential cookies are set until the visitor answers. The bag, sign-in and checkout keep working while the banner is open (it is not modal).
- The answer is kept in a `duis_consent` cookie for 12 months: `<version>.<analytics><marketing>.<visitor id>`. Bumping `CONSENT_VERSION` asks everyone again.
- The cookie is not httpOnly, so the page can read it and decide what to load. Forging it only changes what that browser itself sends.
- Every answer is appended to `consent_records`: the random visitor ID, the account if signed in, both choices, the version, the source (banner or settings) and the user agent. No IP address. UPDATE and DELETE are revoked from the app role.
- "Cookie settings" in the footer reopens the banner. Withdrawing a category that has already loaded deletes its cookies and reloads the page, because a running script can't be unloaded.

**Why.** DPDP requires consent that is free, specific and as easy to withdraw as to give, with proof of what was agreed. An equally visible "Reject all" is also what Google's and Meta's consent rules expect.

### GA4 and the Meta Pixel

**Decision.**
- `gtag.js` is requested only after analytics consent, and `fbevents.js` only after marketing consent. This is Google Consent Mode "basic": no cookieless pings before consent.
- When GA4 loads, it sets Consent Mode defaults from the answer (`ad_storage`, `ad_user_data` and `ad_personalization` follow the Marketing choice).
- Events: `view_item`, `add_to_cart`, `begin_checkout` and `purchase` (GA4), and `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout` and `Purchase` (Pixel).
- Events raised before the visitor answers wait in memory (at most 20) and are sent only if they accept.
- A purchase is recorded once per browser; reloading the confirmation page doesn't repeat it.
- Items are identified by product ID on both the browser and the server.

**Why.** The exit criterion is "no analytics or Pixel requests before consent". Consent Mode "advanced" would send pings before consent, so it is not used.

### Conversions API

**Decision.**
- At checkout, the Server Action stores `orders.marketing_context` only if the browser gave marketing consent. It holds Meta's `_fbp` and `_fbc` cookies (format-checked; bad values are dropped) and the user agent.
- When the order is confirmed, an `analytics.meta-purchase` job sends `Purchase` to Meta, if `META_CAPI_ACCESS_TOKEN` is set.
- It uses `event_id` `purchase-<order number>`, the same as the browser Pixel, so Meta counts it once.
- Email, phone, account ID, city, state, PIN and country are normalised and SHA-256 hashed. The IP address is never sent.
- It is **unverified** until the Pixel and token exist (doc/10 A11). `META_CAPI_TEST_EVENT_CODE` routes events to Events Manager → Test events for checking.

**Why.** Server events survive ad blockers and fire only after the payment is verified on the server. Sharing the event ID prevents double counting.

### IDs at request time

**Decision.** `GA4_MEASUREMENT_ID`, `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN` and `META_CAPI_TEST_EVENT_CODE` are ordinary server variables, read per request (behind `connection()`) and passed to the page. They replace the `NEXT_PUBLIC_*` placeholders. Each feature is off while its value is unset.

**Why.** `NEXT_PUBLIC_*` values are fixed at build time, but one Docker image serves every environment (ADR-016).

### Contact form

**Decision.**
- The form sits below the CMS content on `/contact`.
- Messages are saved to `contact_messages` and listed in **Admin → Messages** (new, replied or closed; who handled it; a staff note; audited).
- Each message is emailed to the support address from Settings (falling back to the reply-to address), with reply-to set to the customer. If neither address is set, the message is only in the inbox.
- No acknowledgement goes to the address typed in, so the form can't be used to send our mail to strangers.
- Abuse limits: a hidden honeypot field, Turnstile once its keys are set, 5 per IP per 10 minutes and 5 per address per hour.
- The inbox reuses the `customer` permissions: reading needs `customer: read` and handling needs `customer: update` (Super Admin, Store Admin and Support).

**Why.** It's the owner's choice. Staff reply from their own mail client, and the inbox keeps a record of who handled what.

## Consequences

- **Owner (doc/10 A11):** create the GA4 property and the Meta Pixel, then set the IDs. Create a Conversions API token, and check a test purchase under Test events before removing `META_CAPI_TEST_EVENT_CODE`.
- **Privacy policy:** it should name Google Analytics and Meta as processors and describe the cookie choices. The CMS policy page needs that text before launch.
- **Admin:** set "Contact-form messages go to" in Settings → Emails.
- **Not yet:** a retention period for contact messages and consent records, and including them in account export and deletion (Phase 7).
- **Tests:** the Playwright exit check runs with placeholder IDs and answers both scripts locally, so nothing reaches Google or Meta.

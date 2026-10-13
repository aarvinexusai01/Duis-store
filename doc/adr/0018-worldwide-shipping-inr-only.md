# ADR-0018: Worldwide shipping at launch, priced in INR

- Status: Accepted (business decision, 2026-10-13); details pending (see doc/10 §1b)
- Date: 2026-10-13

## Context

The plan assumed India-only. The owner changed this to **worldwide shipping at launch**, with **INR as the only currency** (international customers pay in INR by international card through Razorpay; their bank converts).

## Decision

1. **One price list, one currency (INR).** No currency conversion and no per-market price lists. Orders keep a `currency` column (always `INR`) so a later multi-currency change needs no migration.
2. **Country-aware from Phase 1.**
   - Addresses store `country_code` (ISO 3166-1 alpha-2), a generic `postal_code` and `region`.
   - Indian addresses keep their strict 6-digit PIN and state-code validation.
   - Forms adapt per country.
3. **International orders are prepaid only.** Partial COD and the wallet's COD credit flows apply to India only.
4. **Shipping:**
   - The `ShippingProvider` interface gains international rates and shipments, plus customs data (HS code, declared value, item description, country of origin).
   - The international courier is still to be chosen (Shiprocket X, DHL, FedEx or Aramex).
   - Prices and serviceability always come from the provider. Nothing is invented.
5. **Tax:**
   - Domestic orders follow the existing GST lines.
   - Exports are zero-rated under a Letter of Undertaking (LUT) or IGST with refund, to be confirmed by the CA.
   - The export file marks export lines so the external invoicing tool can issue export invoices.
   - Destination duties and taxes are handled under DDU or DDP (open question).
6. **Checkout and compliance:**
   - Show duties and taxes terms before payment.
   - Restrict countries the courier can't serve.
   - Block sanctioned destinations.
   - Store an IEC (Importer-Exporter Code) in store settings for shipping documents.

## Consequences

- An **international shipping work package** is added to Phase 4 (fulfilment), with schema impact in Phase 1 and checkout impact in Phase 3.
- New external prerequisites: Razorpay international payments activation, an international courier account, IEC registration, and an LUT filing.
- The exchange policy for international orders needs a decision (reverse international shipping is expensive).

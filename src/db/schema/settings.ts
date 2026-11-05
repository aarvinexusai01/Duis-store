import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { primaryId, timestamps, timestamptz } from "./columns"

export const codAdvanceType = pgEnum("cod_advance_type", ["fixed", "percent"])
export const rtoAdvancePolicy = pgEnum("rto_advance_policy", [
  "keep",
  "refund",
  "wallet",
])

/**
 * Commerce settings (doc/05 §11): one row (id = 1), edited from the admin
 * portal in Phase 4. Defaults are the values agreed in doc/01 and doc/10.
 */
export const storeSettings = pgTable(
  "store_settings",
  {
    id: integer().primaryKey().default(1),
    freeShippingThresholdPaise: integer().notNull().default(99_900),
    partialCodEnabled: boolean().notNull().default(true),
    codAdvanceType: codAdvanceType().notNull().default("fixed"),
    // Paise when fixed, basis points when percent.
    codAdvanceValue: integer().notNull().default(10_000),
    codMaxOrderPaise: integer().notNull().default(250_000),
    codFeePaise: integer().notNull().default(500),
    reservationTtlMinutes: integer().notNull().default(15),
    exchangeWindowDays: integer().notNull().default(10),
    maxExchangesPerItem: integer().notNull().default(2),
    rtoAdvancePolicy: rtoAdvancePolicy().notNull().default("keep"),
    // Promotional wallet credit only; refunds never expire (doc/10 P12).
    promoCreditValidityDays: integer().notNull().default(30),
    legalName: text(),
    gstin: text(),
    registeredStateCode: text().notNull().default("IN-UP"),
    iecCode: text(),
    lutReference: text(),
    // ISO 3166-1 alpha-2 destinations served outside India (doc/10 I3).
    internationalCountryCodes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Notifications (owner decision 2026-10-16): the sender's display name
    // and reply-to address, and the optional emails. Order confirmations,
    // cancellations, refunds and account emails are always sent.
    emailSenderName: text().notNull().default("Duis"),
    emailReplyTo: text(),
    // Where contact-form messages are emailed (falls back to emailReplyTo).
    supportEmail: text(),
    notifyOrderShipped: boolean().notNull().default(true),
    notifyPaymentReminder: boolean().notNull().default(true),
    notifyLowStock: boolean().notNull().default(true),
    // Prices in US dollars outside India (doc/06 Phase 13, ADR-0034). Off
    // until Razorpay has enabled USD; then the delivery country decides.
    usdPricingEnabled: boolean().notNull().default(false),
    // "auto": the latest ECB rate in fx_rates; "manual": the rate below.
    usdRateMode: text().notNull().default("auto"),
    // Rupees per US dollar × 1,000,000 (₹84.50 = 84_500_000).
    usdManualRateMicros: integer(),
    // The increase on product prices for countries without their own, in
    // basis points (1500 = 15%).
    defaultUpliftBp: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    check("store_settings_singleton_check", sql`${t.id} = 1`),
    check(
      "store_settings_usd_check",
      sql`${t.usdRateMode} in ('auto', 'manual') and (${t.usdManualRateMicros} is null or ${t.usdManualRateMicros} between 10000000 and 500000000) and ${t.defaultUpliftBp} between 0 and 10000`,
    ),
    check(
      "store_settings_amounts_check",
      sql`${t.freeShippingThresholdPaise} >= 0 and ${t.codAdvanceValue} >= 0 and ${t.codMaxOrderPaise} >= 0 and ${t.codFeePaise} >= 0`,
    ),
    check(
      "store_settings_ttl_check",
      sql`${t.reservationTtlMinutes} between 5 and 60`,
    ),
    check(
      "store_settings_state_check",
      sql`${t.registeredStateCode} ~ '^IN-[A-Z]{2}$'`,
    ),
  ],
)

/**
 * GST slabs by HSN prefix (doc/03 §1.6): the lower rate applies while the
 * per-piece value before tax is at or below the threshold. Rows are
 * date-ranged so a rate change never rewrites past orders.
 */
export const taxRules = pgTable(
  "tax_rules",
  {
    id: primaryId(),
    hsnPrefix: text().notNull(),
    priceThresholdPaise: integer(),
    rateBelowBp: integer().notNull(),
    rateAboveBp: integer().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    ...timestamps(),
  },
  (t) => [
    index("tax_rules_hsn_idx").on(t.hsnPrefix, t.effectiveFrom),
    check("tax_rules_hsn_check", sql`${t.hsnPrefix} ~ '^[0-9]{2,8}$'`),
    check(
      "tax_rules_rates_check",
      sql`${t.rateBelowBp} between 0 and 10000 and ${t.rateAboveBp} between 0 and 10000`,
    ),
  ],
)

/**
 * Per-country pricing for USD orders (doc/06 Phase 13): the increase on
 * product prices (null: the store default) and a flat shipping fee in US
 * cents. A country on the shipping list without a row can't check out yet.
 */
export const countryPricing = pgTable(
  "country_pricing",
  {
    countryCode: text().primaryKey(),
    upliftBp: integer(),
    shippingFeeCents: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    check(
      "country_pricing_check",
      sql`${t.countryCode} ~ '^[A-Z]{2}$' and ${t.countryCode} <> 'IN' and (${t.upliftBp} is null or ${t.upliftBp} between 0 and 10000) and ${t.shippingFeeCents} between 0 and 1000000`,
    ),
  ],
)

/**
 * Exchange rates as published (doc/06 Phase 13): one row per source day.
 * The latest row is the "last good rate" when a fetch fails.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    id: primaryId(),
    base: text().notNull().default("USD"),
    quote: text().notNull().default("INR"),
    // Rupees per US dollar × 1,000,000.
    rateMicros: integer().notNull(),
    asOf: date().notNull(),
    source: text().notNull(),
    fetchedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fx_rates_day_key").on(t.base, t.quote, t.asOf),
    check("fx_rates_rate_check", sql`${t.rateMicros} > 0`),
  ],
)

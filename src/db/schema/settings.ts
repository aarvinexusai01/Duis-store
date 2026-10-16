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
} from "drizzle-orm/pg-core"

import { primaryId, timestamps } from "./columns"

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
    notifyOrderShipped: boolean().notNull().default(true),
    notifyPaymentReminder: boolean().notNull().default(true),
    notifyLowStock: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check("store_settings_singleton_check", sql`${t.id} = 1`),
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

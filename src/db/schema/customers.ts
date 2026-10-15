import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { primaryId, timestamps, timestamptz } from "./columns"

export const customerProfiles = pgTable("customer_profiles", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // Separate, withdrawable consents (DPDP): null means not given.
  marketingEmailConsentAt: timestamptz(),
  marketingWhatsappConsentAt: timestamptz(),
  codBlocked: boolean().notNull().default(false),
  codBlockedReason: text(),
  deletionRequestedAt: timestamptz(),
  ...timestamps(),
})

/**
 * Country-aware addresses (ADR-018). Indian addresses must carry a 6-digit
 * PIN and an ISO 3166-2:IN state code; others a postal code and region.
 */
export const addresses = pgTable(
  "addresses",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text().notNull(),
    phone: text().notNull(),
    line1: text().notNull(),
    line2: text(),
    landmark: text(),
    city: text().notNull(),
    region: text(),
    stateCode: text(),
    postalCode: text().notNull(),
    countryCode: text().notNull().default("IN"),
    type: text().notNull().default("home"),
    isDefault: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("addresses_user_idx").on(t.userId),
    uniqueIndex("addresses_one_default_idx")
      .on(t.userId)
      .where(sql`${t.isDefault}`),
    check("addresses_type_check", sql`${t.type} in ('home', 'work', 'other')`),
    check("addresses_country_check", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check("addresses_phone_check", sql`${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check(
      "addresses_india_check",
      sql`${t.countryCode} <> 'IN' or (${t.postalCode} ~ '^[1-9][0-9]{5}$' and ${t.stateCode} ~ '^IN-[A-Z]{2}$')`,
    ),
  ],
)

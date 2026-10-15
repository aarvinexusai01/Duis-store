import { sql } from "drizzle-orm"
import { boolean, check, integer, pgTable, text } from "drizzle-orm/pg-core"

import { timestamptz } from "./columns"

/**
 * Courier serviceability per Indian PIN code, cached for 24 hours. Values
 * always come from the shipping provider — never invented (doc/03 §6).
 */
export const pincodeServiceability = pgTable(
  "pincode_serviceability",
  {
    pincode: text().primaryKey(),
    serviceable: boolean().notNull(),
    prepaidAvailable: boolean().notNull(),
    codAvailable: boolean().notNull(),
    eddMinDays: integer(),
    eddMaxDays: integer(),
    provider: text().notNull(),
    checkedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    check(
      "pincode_serviceability_pincode_check",
      sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`,
    ),
  ],
)

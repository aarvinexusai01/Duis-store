import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { productVariants } from "./catalog"
import { citext, primaryId, timestamptz } from "./columns"

/**
 * "Notify me" on a sold-out size (doc/06 Phase 5 §6). One pending alert per
 * size and address; it is sent once, then ends.
 */
export const stockAlerts = pgTable(
  "stock_alerts",
  {
    id: primaryId(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    email: citext().notNull(),
    whatsapp: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
    notifiedAt: timestamptz(),
  },
  (t) => [
    uniqueIndex("stock_alerts_pending_idx")
      .on(t.variantId, t.email)
      .where(sql`${t.notifiedAt} is null`),
    index("stock_alerts_variant_idx").on(t.variantId, t.notifiedAt),
  ],
)

/**
 * Login code requests (OTP abuse limits): only a hash of the phone number,
 * kept for a day.
 */
export const otpRequests = pgTable(
  "otp_requests",
  {
    id: primaryId(),
    phoneHash: text().notNull(),
    ip: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("otp_requests_phone_idx").on(t.phoneHash, t.createdAt),
    index("otp_requests_ip_idx").on(t.ip, t.createdAt),
  ],
)

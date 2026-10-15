import { pgEnum, pgTable, text } from "drizzle-orm/pg-core"

import { citext, primaryId, timestamps, timestamptz } from "./columns"

export const newsletterStatus = pgEnum("newsletter_status", [
  "pending",
  "confirmed",
  "unsubscribed",
])

/** Double opt-in: an address only receives newsletters once confirmed. */
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: primaryId(),
  email: citext().notNull().unique(),
  status: newsletterStatus().notNull().default("pending"),
  // SHA-256 of the token in the confirmation link.
  confirmTokenHash: text(),
  consentAt: timestamptz().notNull(),
  confirmedAt: timestamptz(),
  unsubscribedAt: timestamptz(),
  source: text(),
  ...timestamps(),
})

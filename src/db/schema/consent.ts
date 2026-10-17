import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { citext, primaryId, timestamps, timestamptz } from "./columns"

/**
 * Cookie consent answers (doc/06 Phase 5 §8, DPDP): one row per answer,
 * append-only (UPDATE/DELETE revoked from the app role). The visitor ID is
 * random and lives in the consent cookie; no IP address is kept.
 */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: primaryId(),
    visitorId: uuid().notNull(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    analytics: boolean().notNull(),
    marketing: boolean().notNull(),
    // The banner's categories version; a new version asks again.
    version: integer().notNull(),
    source: text().notNull(),
    userAgent: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("consent_records_visitor_idx").on(t.visitorId, t.createdAt),
    index("consent_records_user_idx").on(t.userId),
    check(
      "consent_records_source_check",
      sql`${t.source} in ('banner', 'settings')`,
    ),
  ],
)

export const contactMessageStatus = pgEnum("contact_message_status", [
  "new",
  "replied",
  "closed",
])

/** The contact form (owner decision 2026-10-16): an admin inbox plus email. */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: primaryId(),
    name: text().notNull(),
    email: citext().notNull(),
    phone: text(),
    orderNumber: text(),
    topic: text().notNull(),
    message: text().notNull(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    status: contactMessageStatus().notNull().default("new"),
    handledBy: uuid().references(() => users.id, { onDelete: "set null" }),
    handledAt: timestamptz(),
    note: text(),
    ...timestamps(),
  },
  (t) => [
    index("contact_messages_status_idx").on(t.status, t.createdAt.desc()),
    index("contact_messages_email_idx").on(t.email),
    check(
      "contact_messages_topic_check",
      sql`${t.topic} in ('order', 'exchange', 'product', 'other')`,
    ),
    check(
      "contact_messages_length_check",
      sql`char_length(${t.message}) between 1 and 5000`,
    ),
  ],
)

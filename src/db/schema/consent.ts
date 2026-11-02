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
      sql`${t.topic} in ('order', 'exchange', 'product', 'privacy', 'other')`,
    ),
    check(
      "contact_messages_length_check",
      sql`char_length(${t.message}) between 1 and 5000`,
    ),
  ],
)

/**
 * DPDP consents (doc/06 Phase 12): one row per tick or withdrawal, with the
 * notice version shown, so the shop can prove the notice and the consent
 * (Act s.6(10)). Append-only like the cookie answers. Guests are identified
 * by a keyed hash of their email or phone, never the address itself.
 */
export const dataConsents = pgTable(
  "data_consents",
  {
    id: primaryId(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    subjectHash: text(),
    purpose: text().notNull(),
    granted: boolean().notNull(),
    noticeVersion: text().notNull(),
    language: text().notNull().default("en"),
    // The form or page the tick came from.
    source: text().notNull(),
    referenceType: text(),
    referenceId: text(),
    userAgent: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("data_consents_user_idx").on(t.userId, t.purpose, t.createdAt),
    index("data_consents_subject_idx").on(t.subjectHash),
    check(
      "data_consents_who_check",
      sql`${t.userId} is not null or ${t.subjectHash} is not null`,
    ),
    check(
      "data_consents_purpose_check",
      sql`${t.purpose} in ('account', 'age', 'order', 'address', 'contact', 'stock_alert', 'review', 'exchange', 'marketing', 'marketing_whatsapp', 'whatsapp_updates', 'nominee')`,
    ),
    check("data_consents_language_check", sql`${t.language} in ('en', 'hi')`),
  ],
)

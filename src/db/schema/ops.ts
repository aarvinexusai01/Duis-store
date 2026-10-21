import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { primaryId, timestamps, timestamptz } from "./columns"

/** Append-only (UPDATE/DELETE revoked from the app role). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: primaryId(),
    actorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    actorType: text().notNull(),
    actorRoles: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    changes: jsonb(),
    ip: text(),
    requestId: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
)

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text().primaryKey(),
    scope: text().notNull(),
    requestHash: text().notNull(),
    response: jsonb(),
    createdAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz().notNull(),
  },
  (t) => [index("idempotency_keys_expiry_idx").on(t.expiresAt)],
)

export const notificationChannel = pgEnum("notification_channel", [
  "email",
  "sms",
  "whatsapp",
])
export const notificationStatus = pgEnum("notification_status", [
  "queued",
  "sent",
  "failed",
])

export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: primaryId(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    channel: notificationChannel().notNull(),
    template: text().notNull(),
    // Masked (e.g. s****h@gmail.com, +91******3210); never message bodies.
    recipient: text().notNull(),
    status: notificationStatus().notNull().default("queued"),
    provider: text(),
    providerMessageId: text(),
    attempts: integer().notNull().default(0),
    error: text(),
    referenceType: text(),
    referenceId: text(),
    sentAt: timestamptz(),
    ...timestamps(),
  },
  (t) => [
    index("notification_logs_status_idx").on(t.status, t.createdAt),
    index("notification_logs_user_idx").on(t.userId, t.createdAt),
  ],
)

/**
 * Operational health (doc/07 §7, Phase 7): one row per check. The backup
 * container and the host-check script write their own rows as the database
 * superuser; the worker fills in the rest and emails ops when one fails.
 */
export const opsChecks = pgTable("ops_checks", {
  key: text().primaryKey(),
  ok: boolean().notNull(),
  // Short and free of personal data: it is shown on the System page and emailed.
  detail: text(),
  checkedAt: timestamptz().notNull().defaultNow(),
  lastOkAt: timestamptz(),
  // When ops were last emailed about this check failing; cleared once it recovers.
  alertedAt: timestamptz(),
})

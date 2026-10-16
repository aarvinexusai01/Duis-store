import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { primaryId, timestamps, timestamptz } from "./columns"
import { orders } from "./orders"

export const paymentPurpose = pgEnum("payment_purpose", [
  "full",
  "advance",
  "exchange_difference",
])
export const paymentStatus = pgEnum("payment_status", [
  "created",
  "authorized",
  "captured",
  "failed",
  "refunded",
  "partially_refunded",
])
export const refundStatus = pgEnum("refund_status", [
  "pending",
  "processed",
  "failed",
])

/** One row per gateway order (a retry after a failure is a new row). */
export const payments = pgTable(
  "payments",
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    purpose: paymentPurpose().notNull(),
    provider: text().notNull(),
    providerOrderId: text().notNull().unique(),
    providerPaymentId: text().unique(),
    amountPaise: integer().notNull(),
    refundedPaise: integer().notNull().default(0),
    currency: text().notNull().default("INR"),
    status: paymentStatus().notNull().default("created"),
    method: text(),
    errorCode: text(),
    errorReason: text(),
    capturedAt: timestamptz(),
    raw: jsonb(),
    ...timestamps(),
  },
  (t) => [
    index("payments_order_idx").on(t.orderId, t.createdAt),
    check(
      "payments_amount_check",
      sql`${t.amountPaise} > 0 and ${t.refundedPaise} between 0 and ${t.amountPaise}`,
    ),
  ],
)

export const refunds = pgTable(
  "refunds",
  {
    id: primaryId(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    amountPaise: integer().notNull(),
    reason: text().notNull(),
    status: refundStatus().notNull().default("pending"),
    providerRefundId: text().unique(),
    idempotencyKey: text().notNull().unique(),
    initiatedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("refunds_order_idx").on(t.orderId),
    check("refunds_amount_check", sql`${t.amountPaise} > 0`),
  ],
)

export const webhookStatus = pgEnum("webhook_status", [
  "received",
  "processed",
  "ignored",
  "failed",
])

/** Every inbound webhook, deduplicated by the provider's event id. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: primaryId(),
    provider: text().notNull(),
    eventId: text().notNull(),
    eventType: text().notNull(),
    payload: jsonb().notNull(),
    status: webhookStatus().notNull().default("received"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    receivedAt: timestamptz().notNull().defaultNow(),
    processedAt: timestamptz(),
  },
  (t) => [
    uniqueIndex("webhook_events_provider_event_idx").on(t.provider, t.eventId),
    index("webhook_events_status_idx").on(t.status, t.receivedAt),
  ],
)

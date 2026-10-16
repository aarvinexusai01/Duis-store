import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { productVariants } from "./catalog"
import { primaryId, timestamps, timestamptz } from "./columns"
import { orderItems, orders } from "./orders"
import { payments } from "./payments"

/**
 * Photos customers attach to an exchange or a review (doc/08 §2): re-encoded
 * (no metadata) and kept in private storage. Review photos are shown only
 * once the review is approved.
 */
export const customerPhotos = pgTable(
  "customer_photos",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileKey: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index("customer_photos_user_idx").on(t.userId, t.createdAt)],
)

export const exchangeStatus = pgEnum("exchange_status", [
  "requested",
  "awaiting_payment",
  "approved",
  "rejected",
  "cancelled",
  "pickup_scheduled",
  "picked_up",
  "received",
  "qc_passed",
  "qc_failed",
  "replacement_shipped",
  "completed",
])

export const exchangeReason = pgEnum("exchange_reason", [
  "too_small",
  "too_large",
  "colour",
  "damaged",
  "wrong_item",
  "other",
])

/** EX-100001, EX-100002… */
export const exchangeNumberSeq = pgSequence("exchange_number_seq", {
  startWith: 100001,
})

/**
 * Self-service exchanges (doc/03 §7): the same product in another size or
 * colour. The replacement's stock is held from approval; a price difference
 * is paid through the gateway or credited to the wallet.
 */
export const exchangeRequests = pgTable(
  "exchange_requests",
  {
    id: primaryId(),
    exchangeNumber: text()
      .notNull()
      .unique()
      .default(sql`'EX-' || nextval('exchange_number_seq')`),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    quantity: integer().notNull(),
    requestedVariantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    reason: exchangeReason().notNull(),
    customerNote: text(),
    status: exchangeStatus().notNull().default("requested"),
    // Positive: the customer pays; negative: credited to the wallet.
    priceDifferencePaise: integer().notNull().default(0),
    differencePaymentId: uuid().references(() => payments.id, {
      onDelete: "restrict",
    }),
    decidedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamptz(),
    decisionNote: text(),
    qcNote: text(),
    completedAt: timestamptz(),
    ...timestamps(),
  },
  (t) => [
    index("exchange_requests_order_idx").on(t.orderId),
    index("exchange_requests_status_idx").on(t.status, t.createdAt),
    // One open exchange per order line at a time.
    uniqueIndex("exchange_requests_one_open_idx")
      .on(t.orderItemId)
      .where(
        sql`${t.status} not in ('rejected', 'cancelled', 'completed', 'qc_failed')`,
      ),
    check("exchange_requests_quantity_check", sql`${t.quantity} > 0`),
  ],
)

export const exchangeRequestPhotos = pgTable(
  "exchange_request_photos",
  {
    exchangeId: uuid()
      .notNull()
      .references(() => exchangeRequests.id, { onDelete: "cascade" }),
    photoId: uuid()
      .notNull()
      .references(() => customerPhotos.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.exchangeId, t.photoId] })],
)

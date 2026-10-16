import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { primaryId, timestamps, timestamptz } from "./columns"
import { orderItems, orders } from "./orders"

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

export const shipmentDirection = pgEnum("shipment_direction", [
  "forward",
  "reverse",
  "replacement",
])

/**
 * Our normalised shipment states (doc/03 §6). Courier status words are
 * mapped onto these in features/shipping/status.ts.
 */
export const shipmentStatus = pgEnum("shipment_status", [
  "pending",
  "ready_to_ship",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "undelivered",
  "delivered",
  "rto_initiated",
  "rto_delivered",
  "cancelled",
  "lost",
])

export type ShipmentSteps = {
  providerOrderId?: string
  providerShipmentId?: string
  awb?: string
  labelStored?: boolean
  pickupRequested?: boolean
}

/** Export paperwork carried with an international parcel (ADR-018). */
export type ShipmentCustoms = {
  terms: "DDU" | "DDP"
  lines: {
    description: string
    hsCode: string
    quantity: number
    declaredValuePaise: number
    countryOfOrigin: string
  }[]
}

/**
 * One parcel (doc/05 §8). Creation runs in resumable steps (courier order →
 * AWB → label → pickup); `steps` records what is done, and the lease stops
 * two workers advancing the same shipment at once.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    // Exchanges arrive in Phase 5; the column is ready for them.
    exchangeId: uuid(),
    direction: shipmentDirection().notNull().default("forward"),
    provider: text().notNull(),
    channelOrderId: text().notNull().unique(),
    providerOrderId: text(),
    providerShipmentId: text(),
    awb: text().unique(),
    courierName: text(),
    status: shipmentStatus().notNull().default("pending"),
    codAmountPaise: integer().notNull().default(0),
    weightGrams: integer().notNull(),
    lengthCm: integer().notNull(),
    breadthCm: integer().notNull(),
    heightCm: integer().notNull(),
    labelFileKey: text(),
    steps: jsonb().$type<ShipmentSteps>().notNull().default({}),
    customs: jsonb().$type<ShipmentCustoms>(),
    lastError: text(),
    attempts: integer().notNull().default(0),
    leaseUntil: timestamptz(),
    pickupScheduledAt: timestamptz(),
    shippedAt: timestamptz(),
    deliveredAt: timestamptz(),
    cancelledAt: timestamptz(),
    edd: timestamptz(),
    lastEventAt: timestamptz(),
    lastSyncedAt: timestamptz(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("shipments_order_idx").on(t.orderId),
    index("shipments_active_idx")
      .on(t.status, t.lastSyncedAt)
      .where(
        sql`${t.status} not in ('delivered', 'rto_delivered', 'cancelled', 'lost')`,
      ),
    // One live parcel per order (owner decision, 2026-10-16).
    uniqueIndex("shipments_one_forward_idx")
      .on(t.orderId)
      .where(sql`${t.direction} = 'forward' and ${t.status} <> 'cancelled'`),
    check(
      "shipments_size_check",
      sql`${t.weightGrams} > 0 and ${t.lengthCm} > 0 and ${t.breadthCm} > 0 and ${t.heightCm} > 0 and ${t.codAmountPaise} >= 0`,
    ),
  ],
)

export const shipmentItems = pgTable(
  "shipment_items",
  {
    shipmentId: uuid()
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantity: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.shipmentId, t.orderItemId] }),
    check("shipment_items_quantity_check", sql`${t.quantity} > 0`),
  ],
)

/** Courier scans, deduplicated on (shipment, courier status, time). */
export const shipmentTrackingEvents = pgTable(
  "shipment_tracking_events",
  {
    id: primaryId(),
    shipmentId: uuid()
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    providerStatus: text().notNull(),
    // Null when the courier word has no mapping yet (kept, never applied).
    status: shipmentStatus(),
    location: text(),
    description: text(),
    occurredAt: timestamptz().notNull(),
    raw: jsonb(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipment_tracking_events_dedupe_idx").on(
      t.shipmentId,
      t.providerStatus,
      t.occurredAt,
    ),
    index("shipment_tracking_events_shipment_idx").on(
      t.shipmentId,
      t.occurredAt,
    ),
  ],
)

/** Courier API tokens (Shiprocket's lasts days); refreshed before expiry. */
export const providerTokens = pgTable("provider_tokens", {
  provider: text().primaryKey(),
  token: text().notNull(),
  expiresAt: timestamptz().notNull(),
  updatedAt: timestamptz().notNull().defaultNow(),
})

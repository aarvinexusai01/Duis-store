import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { productVariants } from "./catalog"
import { exchangeRequests } from "./exchanges"
import { orders } from "./orders"
import { citext, primaryId, timestamps, timestamptz } from "./columns"

export const reservationStatus = pgEnum("reservation_status", [
  "active",
  "committed",
  "released",
  "expired",
])

export const movementReason = pgEnum("inventory_movement_reason", [
  "receive",
  "adjust",
  "sale",
  "cancel_restock",
  "exchange_out",
  "exchange_in",
  "rto_restock",
  "damaged",
  "count_correction",
])

export const stockLocations = pgTable(
  "stock_locations",
  {
    id: primaryId(),
    code: citext().notNull().unique(),
    name: text().notNull(),
    addressLine1: text().notNull(),
    city: text().notNull(),
    stateCode: text().notNull(),
    postalCode: text().notNull(),
    countryCode: text().notNull().default("IN"),
    shiprocketPickupCode: text(),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("stock_locations_one_default_idx")
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
)

/**
 * Stock per variant per location. Available = on_hand − reserved. The CHECK
 * plus single-statement conditional updates make overselling impossible
 * (doc/03 §2).
 */
export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    locationId: uuid()
      .notNull()
      .references(() => stockLocations.id, { onDelete: "restrict" }),
    onHand: integer().notNull().default(0),
    reserved: integer().notNull().default(0),
    lowStockThreshold: integer().notNull().default(5),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.locationId] }),
    check(
      "inventory_levels_quantities_check",
      sql`${t.onHand} >= 0 and ${t.reserved} >= 0 and ${t.reserved} <= ${t.onHand}`,
    ),
    check("inventory_levels_threshold_check", sql`${t.lowStockThreshold} >= 0`),
    index("inventory_levels_location_idx").on(t.locationId),
  ],
)

export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: primaryId(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    locationId: uuid()
      .notNull()
      .references(() => stockLocations.id, { onDelete: "restrict" }),
    quantity: integer().notNull(),
    orderId: uuid().references(() => orders.id, { onDelete: "restrict" }),
    exchangeId: uuid().references(() => exchangeRequests.id, {
      onDelete: "restrict",
    }),
    status: reservationStatus().notNull().default("active"),
    expiresAt: timestamptz().notNull(),
    ...timestamps(),
  },
  (t) => [
    check("inventory_reservations_quantity_check", sql`${t.quantity} > 0`),
    index("inventory_reservations_active_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active'`),
    index("inventory_reservations_order_idx").on(t.orderId),
    index("inventory_reservations_exchange_idx").on(t.exchangeId),
  ],
)

/** Append-only history of every on-hand change (UPDATE/DELETE revoked). */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: primaryId(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    locationId: uuid()
      .notNull()
      .references(() => stockLocations.id, { onDelete: "restrict" }),
    deltaOnHand: integer().notNull(),
    reason: movementReason().notNull(),
    referenceType: text(),
    referenceId: uuid(),
    note: text(),
    actorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    check("inventory_movements_delta_check", sql`${t.deltaOnHand} <> 0`),
    index("inventory_movements_variant_idx").on(t.variantId, t.createdAt),
  ],
)

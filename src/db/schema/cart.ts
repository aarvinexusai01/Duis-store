import { sql } from "drizzle-orm"
import {
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
import { products, productVariants } from "./catalog"
import { primaryId, timestamps, timestamptz } from "./columns"

export const cartStatus = pgEnum("cart_status", [
  "active",
  "merged",
  "converted",
])

/**
 * Carts exist before sign-in: an anonymous cart is found by the SHA-256 of
 * a random cookie token (the token itself is never stored), and is merged
 * into the customer's cart when they sign in.
 */
export const carts = pgTable(
  "carts",
  {
    id: primaryId(),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    anonymousTokenHash: text().unique(),
    status: cartStatus().notNull().default("active"),
    lastActivityAt: timestamptz().notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("carts_one_active_per_user_idx")
      .on(t.userId)
      .where(sql`${t.status} = 'active' and ${t.userId} is not null`),
    index("carts_activity_idx").on(t.status, t.lastActivityAt),
    check(
      "carts_owner_check",
      sql`${t.userId} is not null or ${t.anonymousTokenHash} is not null`,
    ),
  ],
)

export const cartItems = pgTable(
  "cart_items",
  {
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.cartId, t.variantId] }),
    check("cart_items_quantity_check", sql`${t.quantity} between 1 and 10`),
  ],
)

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.productId] }),
    index("wishlist_items_product_idx").on(t.productId),
  ],
)

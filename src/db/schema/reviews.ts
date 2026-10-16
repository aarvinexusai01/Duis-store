import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { products } from "./catalog"
import { primaryId, timestamps, timestamptz } from "./columns"
import { customerPhotos } from "./exchanges"
import { orderItems } from "./orders"

export const reviewStatus = pgEnum("review_status", [
  "pending",
  "approved",
  "rejected",
])
export const reviewFit = pgEnum("review_fit", [
  "runs_small",
  "true_to_size",
  "runs_large",
])

/**
 * Verified-buyer reviews (doc/06 Phase 5 §5): one per order line, every one
 * moderated before it shows (doc/10 P14).
 */
export const reviews = pgTable(
  "reviews",
  {
    id: primaryId(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderItemId: uuid()
      .notNull()
      .unique()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    rating: integer().notNull(),
    title: text(),
    body: text().notNull(),
    fit: reviewFit(),
    displayName: text().notNull(),
    status: reviewStatus().notNull().default("pending"),
    moderatedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    moderatedAt: timestamptz(),
    moderationNote: text(),
    ...timestamps(),
  },
  (t) => [
    index("reviews_product_idx").on(t.productId, t.status, t.createdAt),
    index("reviews_status_idx").on(t.status, t.createdAt),
    check("reviews_rating_check", sql`${t.rating} between 1 and 5`),
    check(
      "reviews_body_check",
      sql`char_length(${t.body}) between 10 and 2000`,
    ),
  ],
)

export const reviewPhotos = pgTable(
  "review_photos",
  {
    reviewId: uuid()
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    photoId: uuid()
      .notNull()
      .references(() => customerPhotos.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.photoId] })],
)

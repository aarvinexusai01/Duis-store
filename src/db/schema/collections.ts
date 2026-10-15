import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { products } from "./catalog"
import {
  citext,
  primaryId,
  seoColumns,
  timestamps,
  timestamptz,
} from "./columns"
import { mediaAssets } from "./media"

export const publicationStatus = pgEnum("publication_status", [
  "draft",
  "published",
  "archived",
])
export const collectionType = pgEnum("collection_type", ["manual", "automatic"])
export const collectionSortMode = pgEnum("collection_sort_mode", [
  "manual",
  "best_selling",
  "newest",
  "price_asc",
  "price_desc",
])
export const membershipSource = pgEnum("collection_membership_source", [
  "manual",
  "rule",
])

/** Validated by collectionRuleSchema in features/collections. */
export type CollectionRule =
  | { field: "price"; operator: "lte" | "gte"; valuePaise: number }
  | { field: "category"; categoryIds: string[] }
  | { field: "tag"; tags: string[] }
  | { field: "created_within_days"; days: number }
  | { field: "attribute_value"; attributeValueIds: string[] }
  | { field: "best_selling"; top: number }

export const collections = pgTable(
  "collections",
  {
    id: primaryId(),
    slug: citext().notNull().unique(),
    title: text().notNull(),
    description: text(),
    imageMediaId: uuid().references(() => mediaAssets.id, {
      onDelete: "restrict",
    }),
    bannerMediaId: uuid().references(() => mediaAssets.id, {
      onDelete: "restrict",
    }),
    type: collectionType().notNull().default("manual"),
    status: publicationStatus().notNull().default("draft"),
    sortMode: collectionSortMode().notNull().default("manual"),
    rules: jsonb().$type<CollectionRule[]>().notNull().default([]),
    ruleMatch: text().notNull().default("all"),
    publishedAt: timestamptz(),
    rulesRefreshedAt: timestamptz(),
    ...seoColumns(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    check(
      "collections_rule_match_check",
      sql`${t.ruleMatch} in ('all', 'any')`,
    ),
    check(
      "collections_rules_check",
      sql`${t.type} = 'manual' or jsonb_array_length(${t.rules}) > 0`,
    ),
    check(
      "collections_published_check",
      sql`${t.status} <> 'published' or ${t.publishedAt} is not null`,
    ),
  ],
)

/**
 * Membership for both kinds: manual rows come from editors, rule rows are
 * rebuilt by the catalog.refresh-auto-collections job.
 */
export const collectionProducts = pgTable(
  "collection_products",
  {
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer().notNull().default(0),
    source: membershipSource().notNull().default("manual"),
    addedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.productId] }),
    index("collection_products_product_idx").on(t.productId),
    index("collection_products_order_idx").on(t.collectionId, t.position),
  ],
)

export const productSalesStats = pgTable("product_sales_stats", {
  productId: uuid()
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  units7d: integer().notNull().default(0),
  units30d: integer().notNull().default(0),
  revenue30dPaise: bigint({ mode: "number" }).notNull().default(0),
  rankBestSelling: integer(),
  rankTrending: integer(),
  refreshedAt: timestamptz().notNull().defaultNow(),
})

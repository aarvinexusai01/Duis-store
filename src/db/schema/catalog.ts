import { sql, type SQL } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import type { RichTextDocument } from "@/lib/rich-text"

import { users } from "./auth"
import {
  citext,
  ltree,
  primaryId,
  seoColumns as seo,
  timestamps,
  timestamptz,
  tsvector,
} from "./columns"
import { mediaAssets } from "./media"

export const productStatus = pgEnum("product_status", [
  "draft",
  "active",
  "archived",
])
export const variantStatus = pgEnum("variant_status", ["active", "inactive"])
export const attributeKind = pgEnum("attribute_kind", ["swatch", "text"])

export type Specification = { label: string; value: string }
export type SizeChartData = {
  columns: string[]
  rows: { size: string; values: string[] }[]
}

export const departments = pgTable("departments", {
  id: primaryId(),
  slug: citext().notNull().unique(),
  name: text().notNull(),
  position: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
  ...seo(),
  ...timestamps(),
})

export const sizeCharts = pgTable(
  "size_charts",
  {
    id: primaryId(),
    name: text().notNull(),
    unit: text().notNull().default("in"),
    chart: jsonb().$type<SizeChartData>().notNull(),
    howToMeasure: text(),
    ...timestamps(),
  },
  (t) => [check("size_charts_unit_check", sql`${t.unit} in ('in', 'cm')`)],
)

/**
 * Category tree. `path` is an ltree of compact category ids (root → self), so
 * subtree queries use `path <@ ancestor.path` and renaming a slug never
 * rewrites descendants. Moving a category rewrites its subtree's paths.
 */
export const categories = pgTable(
  "categories",
  {
    id: primaryId(),
    departmentId: uuid()
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    parentId: uuid().references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),
    path: ltree().notNull(),
    slug: citext().notNull(),
    name: text().notNull(),
    description: text(),
    imageMediaId: uuid().references(() => mediaAssets.id, {
      onDelete: "restrict",
    }),
    sizeChartId: uuid().references(() => sizeCharts.id, {
      onDelete: "set null",
    }),
    defaultHsnCode: text(),
    exchangeAllowed: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    ...seo(),
    ...timestamps(),
  },
  (t) => [
    unique("categories_sibling_slug_key")
      .on(t.departmentId, t.parentId, t.slug)
      .nullsNotDistinct(),
    index("categories_path_gist_idx").using("gist", t.path),
    index("categories_parent_idx").on(t.parentId),
    check(
      "categories_hsn_check",
      sql`${t.defaultHsnCode} is null or ${t.defaultHsnCode} ~ '^[0-9]{4,8}$'`,
    ),
  ],
)

export const attributes = pgTable("attributes", {
  id: primaryId(),
  code: citext().notNull().unique(),
  name: text().notNull(),
  kind: attributeKind().notNull().default("text"),
  // Variant axes (colour, size) define SKUs; the rest describe products.
  isVariantAxis: boolean().notNull().default(false),
  isFilterable: boolean().notNull().default(true),
  position: integer().notNull().default(0),
  ...timestamps(),
})

export const attributeValues = pgTable(
  "attribute_values",
  {
    id: primaryId(),
    attributeId: uuid()
      .notNull()
      .references(() => attributes.id, { onDelete: "cascade" }),
    slug: citext().notNull(),
    label: text().notNull(),
    swatchHex: text(),
    // Groups shades for filtering, e.g. Navy and Sky both filter as "blue".
    filterGroup: citext(),
    position: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("attribute_values_attribute_slug_key").on(t.attributeId, t.slug),
    // Target of composite foreign keys that keep value and attribute aligned.
    unique("attribute_values_id_attribute_key").on(t.id, t.attributeId),
    check(
      "attribute_values_swatch_check",
      sql`${t.swatchHex} is null or ${t.swatchHex} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
  ],
)

export const products = pgTable(
  "products",
  {
    id: primaryId(),
    departmentId: uuid()
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    slug: citext().notNull().unique(),
    title: text().notNull(),
    subtitle: text(),
    description: jsonb().$type<RichTextDocument>(),
    // Plain text of `description`, kept by the service for search and SEO.
    descriptionText: text().notNull().default(""),
    specifications: jsonb().$type<Specification[]>().notNull().default([]),
    material: text(),
    care: text(),
    // Legal Metrology and GST fields (doc/08 §3).
    hsnCode: text().notNull(),
    countryOfOrigin: text().notNull().default("IN"),
    manufacturerDetails: text().notNull(),
    netQuantity: text().notNull().default("1 N"),
    weightGrams: integer().notNull(),
    lengthCm: integer(),
    breadthCm: integer(),
    heightCm: integer(),
    status: productStatus().notNull().default("draft"),
    publishedAt: timestamptz(),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Category names, colours and tags, kept by the service (weight B).
    searchKeywords: text().notNull().default(""),
    searchVector: tsvector().generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', ${products.title}), 'A') || setweight(to_tsvector('english', ${products.searchKeywords}), 'B') || setweight(to_tsvector('english', ${products.descriptionText}), 'C')`,
    ),
    ogMediaId: uuid().references(() => mediaAssets.id, {
      onDelete: "restrict",
    }),
    ...seo(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("products_search_idx").using("gin", t.searchVector),
    index("products_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    index("products_status_published_idx").on(t.status, t.publishedAt),
    check("products_hsn_check", sql`${t.hsnCode} ~ '^[0-9]{4,8}$'`),
    check("products_origin_check", sql`${t.countryOfOrigin} ~ '^[A-Z]{2}$'`),
    check("products_weight_check", sql`${t.weightGrams} > 0`),
    check(
      "products_published_check",
      sql`${t.status} <> 'active' or ${t.publishedAt} is not null`,
    ),
  ],
)

export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    isPrimary: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    index("product_categories_category_idx").on(t.categoryId),
    // Exactly one primary category per product is enforced by the service;
    // the database guarantees there is never more than one.
    uniqueIndex("product_categories_one_primary_idx")
      .on(t.productId)
      .where(sql`${t.isPrimary}`),
  ],
)

/** Which variant axes a product uses, in display order. */
export const productAttributes = pgTable(
  "product_attributes",
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attributeId: uuid()
      .notNull()
      .references(() => attributes.id, { onDelete: "restrict" }),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.attributeId] })],
)

/** Descriptive, filterable values that are not variant axes (fit, sleeve…). */
export const productAttributeValues = pgTable(
  "product_attribute_values",
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attributeValueId: uuid()
      .notNull()
      .references(() => attributeValues.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.attributeValueId] }),
    index("product_attribute_values_value_idx").on(t.attributeValueId),
  ],
)

export const productVariants = pgTable(
  "product_variants",
  {
    id: primaryId(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: citext().notNull().unique(),
    barcode: text(),
    pricePaise: integer().notNull(),
    // MRP, inclusive of all taxes (Legal Metrology); never below the price.
    mrpPaise: integer().notNull(),
    status: variantStatus().notNull().default("active"),
    position: integer().notNull().default(0),
    weightGramsOverride: integer(),
    // Canonical option list, e.g. "color=black;size=l". Prevents duplicates.
    optionSignature: text().notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("product_variants_options_key").on(t.productId, t.optionSignature),
    index("product_variants_product_idx").on(t.productId),
    check("product_variants_price_check", sql`${t.pricePaise} > 0`),
    check("product_variants_mrp_check", sql`${t.mrpPaise} >= ${t.pricePaise}`),
    check(
      "product_variants_weight_check",
      sql`${t.weightGramsOverride} is null or ${t.weightGramsOverride} > 0`,
    ),
  ],
)

export const variantAttributeValues = pgTable(
  "variant_attribute_values",
  {
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    attributeId: uuid().notNull(),
    attributeValueId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.attributeId] }),
    foreignKey({
      name: "variant_attribute_values_value_fk",
      columns: [t.attributeValueId, t.attributeId],
      foreignColumns: [attributeValues.id, attributeValues.attributeId],
    }).onDelete("restrict"),
    index("variant_attribute_values_value_idx").on(
      t.attributeValueId,
      t.variantId,
    ),
  ],
)

export const productMedia = pgTable(
  "product_media",
  {
    id: primaryId(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    mediaId: uuid()
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    // Images specific to one colour; null means "all colours".
    colorValueId: uuid().references(() => attributeValues.id, {
      onDelete: "restrict",
    }),
    position: integer().notNull().default(0),
    altOverride: text(),
    ...timestamps(),
  },
  (t) => [
    unique("product_media_product_media_key").on(t.productId, t.mediaId),
    index("product_media_product_idx").on(t.productId, t.position),
  ],
)

/**
 * One row per product with everything a listing card and the filters need,
 * refreshed by the catalog/inventory services whenever variants, prices,
 * stock or media change (doc/05 §3).
 */
export const productListingCache = pgTable(
  "product_listing_cache",
  {
    productId: uuid()
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    minPricePaise: integer(),
    maxPricePaise: integer(),
    maxDiscountPercent: integer().notNull().default(0),
    inStock: boolean().notNull().default(false),
    // Every filterable value on the product (variant axes and descriptive).
    filterValueIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    // Variant-axis values that have stock available right now.
    inStockValueIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    colorValueIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    primaryMediaId: uuid(),
    hoverMediaId: uuid(),
    refreshedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("product_listing_cache_filters_idx").using("gin", t.filterValueIds),
    index("product_listing_cache_stock_values_idx").using(
      "gin",
      t.inStockValueIds,
    ),
    index("product_listing_cache_price_idx").on(t.minPricePaise),
  ],
)

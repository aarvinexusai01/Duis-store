import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { categories, products } from "./catalog"
import { collections, publicationStatus } from "./collections"
import { citext, primaryId, timestamps, timestamptz } from "./columns"
import { mediaAssets } from "./media"

export const cmsPageType = pgEnum("cms_page_type", [
  "home",
  "landing",
  "static",
  "policy",
])
export const cmsEntityType = pgEnum("cms_entity_type", [
  "page",
  "navigation",
  "site_settings",
  "blog_post",
])
export const cmsWorkflowStatus = pgEnum("cms_workflow_status", [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "archived",
])

/**
 * Every CMS change is a new revision: Zod-validated JSON in `data`, with its
 * references to catalogue rows and media indexed in cms_revision_refs.
 */
export const cmsRevisions = pgTable(
  "cms_revisions",
  {
    id: primaryId(),
    entityType: cmsEntityType().notNull(),
    entityId: uuid().notNull(),
    version: integer().notNull(),
    data: jsonb().notNull(),
    workflowStatus: cmsWorkflowStatus().notNull().default("draft"),
    note: text(),
    // Why a reviewer sent the revision back (shown to its author).
    reviewNote: text(),
    scheduledFor: timestamptz(),
    publishedAt: timestamptz(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    publishedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    unique("cms_revisions_entity_version_key").on(
      t.entityType,
      t.entityId,
      t.version,
    ),
    index("cms_revisions_entity_idx").on(t.entityType, t.entityId),
    index("cms_revisions_scheduled_idx")
      .on(t.scheduledFor)
      .where(sql`${t.workflowStatus} = 'scheduled'`),
  ],
)

/**
 * One row per reference from a revision. Real foreign keys mean a product,
 * collection, category or image used by content cannot be hard-deleted.
 */
export const cmsRevisionRefs = pgTable(
  "cms_revision_refs",
  {
    id: primaryId(),
    revisionId: uuid()
      .notNull()
      .references(() => cmsRevisions.id, { onDelete: "cascade" }),
    productId: uuid().references(() => products.id, { onDelete: "restrict" }),
    collectionId: uuid().references(() => collections.id, {
      onDelete: "restrict",
    }),
    categoryId: uuid().references(() => categories.id, {
      onDelete: "restrict",
    }),
    mediaId: uuid().references(() => mediaAssets.id, { onDelete: "restrict" }),
  },
  (t) => [
    check(
      "cms_revision_refs_one_target_check",
      sql`num_nonnulls(${t.productId}, ${t.collectionId}, ${t.categoryId}, ${t.mediaId}) = 1`,
    ),
    index("cms_revision_refs_revision_idx").on(t.revisionId),
    index("cms_revision_refs_product_idx").on(t.productId),
    index("cms_revision_refs_collection_idx").on(t.collectionId),
    index("cms_revision_refs_category_idx").on(t.categoryId),
    index("cms_revision_refs_media_idx").on(t.mediaId),
  ],
)

const revisionPointer = () =>
  uuid().references((): AnyPgColumn => cmsRevisions.id, {
    onDelete: "restrict",
  })

export const cmsPages = pgTable("cms_pages", {
  id: primaryId(),
  type: cmsPageType().notNull(),
  slug: citext().notNull().unique(),
  title: text().notNull(),
  status: publicationStatus().notNull().default("draft"),
  draftRevisionId: revisionPointer(),
  publishedRevisionId: revisionPointer(),
  publishedAt: timestamptz(),
  createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
})

export const navigationMenus = pgTable("navigation_menus", {
  id: primaryId(),
  key: citext().notNull().unique(),
  name: text().notNull(),
  draftRevisionId: revisionPointer(),
  publishedRevisionId: revisionPointer(),
  ...timestamps(),
})

/** Singleton row (id = 1): brand, contact, social links, SEO defaults. */
export const siteSettings = pgTable(
  "site_settings",
  {
    id: smallint().primaryKey().default(1),
    entityId: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    draftRevisionId: revisionPointer(),
    publishedRevisionId: revisionPointer(),
    ...timestamps(),
  },
  (t) => [check("site_settings_singleton_check", sql`${t.id} = 1`)],
)

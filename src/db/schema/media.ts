import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { primaryId, timestamps, timestamptz } from "./columns"

/**
 * Uploaded images. Files live under MEDIA_ROOT at `{storageKey}/{width}.webp`
 * and `{storageKey}/orig.webp`; every width in `renditions` exists on disk.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: primaryId(),
    storageKey: text().notNull().unique(),
    // SHA-256 of the uploaded bytes: identical uploads reuse one asset.
    sha256: text().notNull().unique(),
    originalFilename: text(),
    mime: text().notNull(),
    bytes: integer().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    renditions: jsonb().$type<number[]>().notNull(),
    altText: text().notNull().default(""),
    caption: text(),
    focalX: real().notNull().default(0.5),
    focalY: real().notNull().default(0.5),
    uploadedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamptz(),
    ...timestamps(),
  },
  (t) => [
    index("media_assets_created_idx").on(t.createdAt),
    check(
      "media_assets_focal_check",
      sql`${t.focalX} between 0 and 1 and ${t.focalY} between 0 and 1`,
    ),
    check(
      "media_assets_dimensions_check",
      sql`${t.width} > 0 and ${t.height} > 0 and ${t.bytes} > 0`,
    ),
  ],
)

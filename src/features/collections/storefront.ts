import "server-only"
import { sql } from "drizzle-orm"

import type { MediaRef } from "@/features/catalog"
import { getDb } from "@/server/db/client"
import { uuidArray } from "@/server/db/sql"

/** Storefront reads for published collections (uncached; see ./queries). */

export type CollectionSummary = {
  id: string
  slug: string
  title: string
  description: string | null
  image: MediaRef | null
  banner: MediaRef | null
  seoTitle: string | null
  seoDescription: string | null
  noindex: boolean
}

type Row = {
  id: string
  slug: string
  title: string
  description: string | null
  seo_title: string | null
  seo_description: string | null
  noindex: boolean
  image_key: string | null
  image_width: number | null
  image_height: number | null
  image_alt: string | null
  banner_key: string | null
  banner_width: number | null
  banner_height: number | null
  banner_alt: string | null
}

const SELECT = sql`
  select c.id, c.slug::text, c.title, c.description, c.seo_title, c.seo_description, c.noindex,
         im.storage_key as image_key, im.width as image_width, im.height as image_height, im.alt_text as image_alt,
         bm.storage_key as banner_key, bm.width as banner_width, bm.height as banner_height, bm.alt_text as banner_alt
  from collections c
  left join media_assets im on im.id = c.image_media_id and im.deleted_at is null
  left join media_assets bm on bm.id = c.banner_media_id and bm.deleted_at is null
`

function toSummary(row: Row): CollectionSummary {
  const ref = (
    key: string | null,
    width: number | null,
    height: number | null,
    alt: string | null,
  ) =>
    key && width && height
      ? { key, width, height, alt: alt ?? row.title }
      : null
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    image: ref(row.image_key, row.image_width, row.image_height, row.image_alt),
    banner: ref(
      row.banner_key,
      row.banner_width,
      row.banner_height,
      row.banner_alt,
    ),
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    noindex: row.noindex,
  }
}

export async function loadCollectionBySlug(
  slug: string,
): Promise<CollectionSummary | null> {
  const result = await getDb().execute<Row>(
    sql`${SELECT} where c.slug = ${slug} and c.status = 'published'`,
  )
  return result.rows[0] ? toSummary(result.rows[0]) : null
}

export async function loadPublishedCollections(): Promise<CollectionSummary[]> {
  const result = await getDb().execute<Row>(
    sql`${SELECT} where c.status = 'published' order by c.published_at desc, c.title`,
  )
  return result.rows.map(toSummary)
}

export async function loadCollectionsByIds(
  ids: readonly string[],
): Promise<Map<string, CollectionSummary>> {
  if (ids.length === 0) return new Map()
  const result = await getDb().execute<Row>(
    sql`${SELECT} where c.id = any(${uuidArray(ids)}) and c.status = 'published'`,
  )
  return new Map(result.rows.map((row) => [row.id, toSummary(row)]))
}

/** Active products of a collection in merchandised order. */
export async function loadCollectionProductIds(
  collectionId: string,
  limit: number,
): Promise<string[]> {
  const result = await getDb().execute<{ id: string }>(sql`
    select p.id from collection_products cp
    join products p on p.id = cp.product_id
    join product_listing_cache lc on lc.product_id = p.id
    where cp.collection_id = ${collectionId} and p.status = 'active' and lc.min_price_paise is not null
    order by cp.position, p.id
    limit ${limit}
  `)
  return result.rows.map((row) => row.id)
}

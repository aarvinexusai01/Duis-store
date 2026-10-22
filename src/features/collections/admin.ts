import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { versionOf } from "@/lib/version"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { collectionRuleSchema, type CollectionRuleInput } from "./schemas"
import { ruleCondition } from "./service"

/** Collection screens (doc/06 Phase 4 §5). */

export type AdminCollectionRow = {
  id: string
  slug: string
  title: string
  type: "manual" | "automatic"
  status: "draft" | "published" | "archived"
  productCount: number
  imageKey: string | null
  updatedAt: Date
}

export const adminListCollections = defineOperation({
  name: "collections.adminList",
  access: { collection: ["read"] },
  input: z.object({}),
  async handler(): Promise<AdminCollectionRow[]> {
    const rows = await getDb().execute<{
      id: string
      slug: string
      title: string
      type: AdminCollectionRow["type"]
      status: AdminCollectionRow["status"]
      product_count: number
      image_key: string | null
      updated_at: Date
    }>(sql`
      select c.id, c.slug::text, c.title, c.type, c.status, c.updated_at,
             (select count(*)::int from collection_products cp where cp.collection_id = c.id) as product_count,
             (select storage_key from media_assets where id = coalesce(c.image_media_id, c.banner_media_id)) as image_key
      from collections c order by c.status = 'archived', c.updated_at desc`)
    return rows.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      type: r.type,
      status: r.status,
      productCount: r.product_count,
      imageKey: r.image_key,
      updatedAt: new Date(r.updated_at),
    }))
  },
})

export type AdminCollection = {
  id: string
  /** Sent back on every save to catch overlapping edits. */
  version: string
  slug: string
  title: string
  description: string | null
  type: "manual" | "automatic"
  status: "draft" | "published" | "archived"
  sortMode: "manual" | "best_selling" | "newest" | "price_asc" | "price_desc"
  rules: CollectionRuleInput[]
  ruleMatch: "all" | "any"
  image: { id: string; key: string } | null
  banner: { id: string; key: string } | null
  seoTitle: string | null
  seoDescription: string | null
  noindex: boolean
  products: {
    id: string
    title: string
    status: string
    imageKey: string | null
    source: "manual" | "rule"
  }[]
}

export const adminGetCollection = defineOperation({
  name: "collections.adminGet",
  access: { collection: ["read"] },
  input: z.object({ id: z.uuid() }),
  async handler(_ctx, { id }): Promise<AdminCollection> {
    const db = getDb()
    const found = await db.execute<{
      id: string
      slug: string
      title: string
      description: string | null
      type: AdminCollection["type"]
      status: AdminCollection["status"]
      sort_mode: AdminCollection["sortMode"]
      rules: CollectionRuleInput[] | null
      rule_match: "all" | "any"
      image_id: string | null
      image_key: string | null
      banner_id: string | null
      banner_key: string | null
      seo_title: string | null
      seo_description: string | null
      noindex: boolean
      updated_at: Date
    }>(sql`
      select c.id, c.slug::text, c.title, c.description, c.type, c.status, c.sort_mode, c.rules, c.rule_match,
             c.seo_title, c.seo_description, c.noindex, c.updated_at,
             im.id as image_id, im.storage_key as image_key, bm.id as banner_id, bm.storage_key as banner_key
      from collections c
      left join media_assets im on im.id = c.image_media_id
      left join media_assets bm on bm.id = c.banner_media_id
      where c.id = ${id}`)
    const c = found.rows[0]
    if (!c) throw new DomainError("NOT_FOUND", "Collection not found.")
    const products = await db.execute<{
      id: string
      title: string
      status: string
      image_key: string | null
      source: "manual" | "rule"
    }>(sql`
      select p.id, p.title, p.status, cp.source,
             (select m.storage_key from product_media pm join media_assets m on m.id = pm.media_id
              where pm.product_id = p.id order by pm.position limit 1) as image_key
      from collection_products cp join products p on p.id = cp.product_id
      where cp.collection_id = ${id} order by cp.position, p.id`)
    return {
      id: c.id,
      version: versionOf(c.updated_at),
      slug: c.slug,
      title: c.title,
      description: c.description,
      type: c.type,
      status: c.status,
      sortMode: c.sort_mode,
      rules: c.rules ?? [],
      ruleMatch: c.rule_match,
      image:
        c.image_id && c.image_key ? { id: c.image_id, key: c.image_key } : null,
      banner:
        c.banner_id && c.banner_key
          ? { id: c.banner_id, key: c.banner_key }
          : null,
      seoTitle: c.seo_title,
      seoDescription: c.seo_description,
      noindex: c.noindex,
      products: products.rows.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        imageKey: p.image_key,
        source: p.source,
      })),
    }
  },
})

/** Live count for the rule builder, using the refresh job's own conditions. */
export const previewCollectionRules = defineOperation({
  name: "collections.previewRules",
  access: { collection: ["read"] },
  input: z.object({
    rules: z.array(collectionRuleSchema).min(1).max(10),
    ruleMatch: z.enum(["all", "any"]),
  }),
  async handler(_ctx, { rules, ruleMatch }) {
    const combined = sql.join(
      rules.map(ruleCondition),
      ruleMatch === "any" ? sql` or ` : sql` and `,
    )
    const result = await getDb().execute<{ title: string; total: number }>(sql`
      select p.title, count(*) over ()::int as total
      from products p
      join product_listing_cache lc on lc.product_id = p.id
      where p.status = 'active' and (${combined})
      order by p.published_at desc nulls last, p.id
      limit 6`)
    return {
      count: result.rows[0]?.total ?? 0,
      sample: result.rows.map((r) => r.title),
    }
  },
})

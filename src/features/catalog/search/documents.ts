import "server-only"
import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"
import { uuidArray } from "@/server/db/sql"

import { loadProductCards } from "../storefront"
import type { SearchDocument } from "./index-definition"

/**
 * Search documents for the given products, built from the same rows the
 * Postgres search and the product cards use. A product that isn't for sale
 * (not active, or no active variant) has no document and is in `absent`.
 */
export async function loadSearchDocuments(
  ids: readonly string[],
): Promise<{ documents: SearchDocument[]; absent: string[] }> {
  if (ids.length === 0) return { documents: [], absent: [] }
  const [result, cards] = await Promise.all([
    getDb().execute<{
      id: string
      title: string
      subtitle: string | null
      search_keywords: string
      description_text: string
      filter_value_ids: string[]
      in_stock_value_ids: string[]
      min_price_paise: number
      max_price_paise: number
      max_discount_percent: number
      in_stock: boolean
      published_at: Date
    }>(sql`
      select p.id, p.title, p.subtitle, p.search_keywords, p.description_text,
             lc.filter_value_ids, lc.in_stock_value_ids, lc.min_price_paise,
             lc.max_price_paise, lc.max_discount_percent, lc.in_stock, p.published_at
      from products p
      join product_listing_cache lc on lc.product_id = p.id
      where p.id = any(${uuidArray(ids)}) and p.status = 'active'
        and lc.min_price_paise is not null
    `),
    loadProductCards(ids),
  ])
  const cardById = new Map(cards.map((card) => [card.id, card]))
  const documents = result.rows.flatMap((row): SearchDocument[] => {
    const card = cardById.get(row.id)
    if (!card) return []
    return [
      {
        id: row.id,
        title: row.title,
        subtitle: row.subtitle ?? "",
        keywords: row.search_keywords,
        description: row.description_text,
        filter_value_ids: row.filter_value_ids,
        in_stock_value_ids: row.in_stock_value_ids,
        min_price_paise: row.min_price_paise,
        max_price_paise: row.max_price_paise,
        max_discount_percent: row.max_discount_percent,
        in_stock: row.in_stock,
        published_at: new Date(row.published_at).toISOString(),
        card,
      },
    ]
  })
  const present = new Set(documents.map((doc) => doc.id))
  return { documents, absent: ids.filter((id) => !present.has(id)) }
}

/** Every product that should be searchable, for a full rebuild. */
export async function loadSearchableProductIds(): Promise<string[]> {
  const result = await getDb().execute<{ id: string }>(sql`
    select p.id from products p
    join product_listing_cache lc on lc.product_id = p.id
    where p.status = 'active' and lc.min_price_paise is not null
    order by p.id`)
  return result.rows.map((row) => row.id)
}

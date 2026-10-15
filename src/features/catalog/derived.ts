import "server-only"
import { sql } from "drizzle-orm"

import type { Database } from "@/server/db/client"
import { uuidArray } from "@/server/db/sql"
import type { Transaction } from "@/server/db/transaction"

type Db = Database | Transaction

/**
 * Rebuilds product_listing_cache rows for the given products: price range,
 * best discount, stock, filter values, in-stock values, colour swatches (in
 * display order) and the first two images. Called after any change to
 * variants, prices, stock, attributes or media.
 */
export async function refreshListingCache(
  db: Db,
  productIds: readonly string[],
) {
  if (productIds.length === 0) return
  await db.execute(sql`
    with target as (
      select distinct unnest(${uuidArray(productIds)}) as product_id
    ),
    variant_stock as (
      select v.id as variant_id, v.product_id, v.price_paise, v.mrp_paise,
             coalesce(sum(l.on_hand - l.reserved) filter (where loc.is_active), 0) as available
      from product_variants v
      join target t on t.product_id = v.product_id
      left join inventory_levels l on l.variant_id = v.id
      left join stock_locations loc on loc.id = l.location_id
      where v.status = 'active'
      group by v.id
    ),
    prices as (
      select product_id,
             min(price_paise) as min_price,
             max(price_paise) as max_price,
             max(floor((mrp_paise - price_paise) * 100.0 / mrp_paise))::int as max_discount,
             bool_or(available > 0) as in_stock
      from variant_stock
      group by product_id
    ),
    axis_values as (
      select vs.product_id, vav.attribute_value_id, vs.available
      from variant_stock vs
      join variant_attribute_values vav on vav.variant_id = vs.variant_id
    ),
    filter_values as (
      select product_id, array_agg(distinct attribute_value_id) as ids
      from (
        select product_id, attribute_value_id from axis_values
        union all
        select pav.product_id, pav.attribute_value_id
        from product_attribute_values pav
        join target t on t.product_id = pav.product_id
      ) all_values
      group by product_id
    ),
    stock_values as (
      select product_id, array_agg(distinct attribute_value_id) as ids
      from axis_values
      where available > 0
      group by product_id
    ),
    colours as (
      select product_id, array_agg(attribute_value_id order by position, attribute_value_id) as ids
      from (
        select distinct ax.product_id, ax.attribute_value_id, val.position
        from axis_values ax
        join attribute_values val on val.id = ax.attribute_value_id
        join attributes a on a.id = val.attribute_id
        where a.code = 'color'
      ) colour_values
      group by product_id
    ),
    media as (
      select pm.product_id,
             (array_agg(pm.media_id order by pm.position, pm.id))[1] as primary_id,
             (array_agg(pm.media_id order by pm.position, pm.id))[2] as hover_id
      from product_media pm
      join target t on t.product_id = pm.product_id
      group by pm.product_id
    )
    insert into product_listing_cache (
      product_id, min_price_paise, max_price_paise, max_discount_percent, in_stock,
      filter_value_ids, in_stock_value_ids, color_value_ids,
      primary_media_id, hover_media_id, refreshed_at
    )
    select t.product_id, p.min_price, p.max_price, coalesce(p.max_discount, 0),
           coalesce(p.in_stock, false),
           coalesce(f.ids, '{}'), coalesce(s.ids, '{}'), coalesce(c.ids, '{}'),
           m.primary_id, m.hover_id, now()
    from target t
    left join prices p on p.product_id = t.product_id
    left join filter_values f on f.product_id = t.product_id
    left join stock_values s on s.product_id = t.product_id
    left join colours c on c.product_id = t.product_id
    left join media m on m.product_id = t.product_id
    where exists (select 1 from products where id = t.product_id)
    on conflict (product_id) do update set
      min_price_paise = excluded.min_price_paise,
      max_price_paise = excluded.max_price_paise,
      max_discount_percent = excluded.max_discount_percent,
      in_stock = excluded.in_stock,
      filter_value_ids = excluded.filter_value_ids,
      in_stock_value_ids = excluded.in_stock_value_ids,
      color_value_ids = excluded.color_value_ids,
      primary_media_id = excluded.primary_media_id,
      hover_media_id = excluded.hover_media_id,
      refreshed_at = excluded.refreshed_at
  `)
}

/**
 * Words that should find a product but are not in its title: category names
 * (including ancestors), colour and other attribute labels, and tags. The
 * generated search vector picks them up at weight B.
 */
export async function refreshSearchKeywords(
  db: Db,
  productIds: readonly string[],
) {
  if (productIds.length === 0) return
  await db.execute(sql`
    update products p
    set search_keywords = coalesce((
      select string_agg(distinct word, ' ')
      from (
        select ancestor.name as word
        from product_categories pc
        join categories c on c.id = pc.category_id
        join categories ancestor on ancestor.path @> c.path
        where pc.product_id = p.id
        union
        select val.label
        from product_variants v
        join variant_attribute_values vav on vav.variant_id = v.id
        join attribute_values val on val.id = vav.attribute_value_id
        where v.product_id = p.id and v.status = 'active'
        union
        select val.label
        from product_attribute_values pav
        join attribute_values val on val.id = pav.attribute_value_id
        where pav.product_id = p.id
        union
        select unnest(p.tags)
      ) words
    ), '')
    where p.id = any(${uuidArray(productIds)})
  `)
}

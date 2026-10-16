import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { stockChanged } from "./service"

/** Stock screens (doc/06 Phase 4 §6). */

export const STOCK_PAGE_SIZE = 50

export type StockRow = {
  variantId: string
  productId: string
  sku: string
  title: string
  label: string
  status: string
  onHand: number
  reserved: number
  available: number
  threshold: number
}

export const adminListStock = defineOperation({
  name: "inventory.adminListStock",
  access: { inventory: ["read"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    lowOnly: z.boolean().default(false),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, { q, lowOnly, page }) {
    const like = q ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null
    const rows = await getDb().execute<{
      variant_id: string
      product_id: string
      sku: string
      title: string
      label: string | null
      status: string
      on_hand: number
      reserved: number
      threshold: number
      total: number
    }>(sql`
      select v.id as variant_id, p.id as product_id, v.sku::text as sku, p.title, v.status,
             coalesce(l.on_hand, 0) as on_hand, coalesce(l.reserved, 0) as reserved,
             coalesce(l.low_stock_threshold, 5) as threshold,
             (select string_agg(av.label, ' / ' order by pa.position) from variant_attribute_values vav
              join attribute_values av on av.id = vav.attribute_value_id
              left join product_attributes pa on pa.product_id = p.id and pa.attribute_id = vav.attribute_id
              where vav.variant_id = v.id) as label,
             count(*) over ()::int as total
      from product_variants v
      join products p on p.id = v.product_id
      left join inventory_levels l on l.variant_id = v.id
        and l.location_id = (select id from stock_locations where is_default)
      where p.status <> 'archived'
        ${like ? sql`and (v.sku::text ilike ${like} or p.title ilike ${like})` : sql``}
        ${lowOnly ? sql`and coalesce(l.on_hand - l.reserved, 0) <= coalesce(l.low_stock_threshold, 5)` : sql``}
      order by (coalesce(l.on_hand - l.reserved, 0) <= coalesce(l.low_stock_threshold, 5)) desc, p.title, v.position
      limit ${STOCK_PAGE_SIZE} offset ${(page - 1) * STOCK_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r): StockRow => ({
        variantId: r.variant_id,
        productId: r.product_id,
        sku: r.sku,
        title: r.title,
        label: r.label ?? "",
        status: r.status,
        onHand: r.on_hand,
        reserved: r.reserved,
        available: r.on_hand - r.reserved,
        threshold: r.threshold,
      })),
    }
  },
})

export type MovementRow = {
  id: string
  sku: string
  title: string
  delta: number
  reason: string
  note: string | null
  reference: string | null
  actor: string | null
  at: Date
}

export const adminListMovements = defineOperation({
  name: "inventory.adminListMovements",
  access: { inventory: ["read"] },
  input: z.object({
    variantId: z.uuid().optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, { variantId, page }) {
    const rows = await getDb().execute<{
      id: string
      sku: string
      title: string
      delta_on_hand: number
      reason: string
      note: string | null
      reference_type: string | null
      reference_id: string | null
      actor: string | null
      created_at: Date
      total: number
    }>(sql`
      select m.id, v.sku::text as sku, p.title, m.delta_on_hand, m.reason, m.note, m.reference_type, m.reference_id,
             u.name as actor, m.created_at, count(*) over ()::int as total
      from inventory_movements m
      join product_variants v on v.id = m.variant_id join products p on p.id = v.product_id
      left join users u on u.id = m.actor_user_id
      where ${variantId ? sql`m.variant_id = ${variantId}` : sql`true`}
      order by m.created_at desc, m.id
      limit ${STOCK_PAGE_SIZE} offset ${(page - 1) * STOCK_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r): MovementRow => ({
        id: r.id,
        sku: r.sku,
        title: r.title,
        delta: r.delta_on_hand,
        reason: r.reason,
        note: r.note,
        reference: r.reference_type ? `${r.reference_type}` : null,
        actor: r.actor,
        at: new Date(r.created_at),
      })),
    }
  },
})

/**
 * Stock count: sets on-hand to what was counted (never below what is
 * reserved) and records the difference as a count correction.
 */
export const setCountedStock = defineOperation({
  name: "inventory.setCountedStock",
  access: { inventory: ["adjust"] },
  input: z.object({
    variantId: z.uuid(),
    counted: z.number().int().min(0).max(1_000_000),
    note: z.string().trim().max(300).optional(),
  }),
  async handler({ actor }, { variantId, counted, note }) {
    return withTransaction(async (tx) => {
      const level = await tx.execute<{
        location_id: string
        on_hand: number
        reserved: number
      }>(sql`
        select l.location_id, l.on_hand, l.reserved from inventory_levels l
        where l.variant_id = ${variantId} and l.location_id = (select id from stock_locations where is_default)
        for update`)
      const row = level.rows[0]
      if (!row)
        throw new DomainError(
          "NOT_FOUND",
          "No stock record for this SKU yet. Receive stock first.",
        )
      if (counted < row.reserved) {
        throw new DomainError(
          "CONFLICT",
          `${row.reserved} units are reserved by open orders; the count can't be lower.`,
        )
      }
      const delta = counted - row.on_hand
      if (delta === 0) return { delta }
      await tx.execute(sql`
        update inventory_levels set on_hand = ${counted}, updated_at = now()
        where variant_id = ${variantId} and location_id = ${row.location_id}`)
      await tx.execute(sql`
        insert into inventory_movements (variant_id, location_id, delta_on_hand, reason, note, actor_user_id)
        values (${variantId}, ${row.location_id}, ${delta}, 'count_correction', ${note ?? null},
                ${actor.kind === "user" ? actor.userId : null})`)
      await stockChanged(tx, [variantId])
      await writeAudit(tx, actor, {
        action: "inventory.count",
        entityType: "product_variant",
        entityId: variantId,
        changes: { from: row.on_hand, to: counted, note },
      })
      return { delta }
    })
  },
})

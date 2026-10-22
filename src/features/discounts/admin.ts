import "server-only"
import { randomInt } from "node:crypto"

import { sql } from "drizzle-orm"
import { z } from "zod"

import type { DiscountEligibility } from "@/db/schema"
import { writeAudit } from "@/server/audit"
import { expectedVersionField, versionOf } from "@/lib/version"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { checkVersion } from "@/server/db/versioning"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { discountFieldsSchema } from "./service"

/**
 * Staff discount tools (doc/06 Phase 4 §7): list, edit, pause, archive, bulk
 * single-use codes and a usage report. Creation is discounts.create.
 */

export const ADMIN_DISCOUNTS_PAGE_SIZE = 50
// Orders that count as sales for usage figures.
const PLACED = sql`o.status not in ('pending_payment', 'expired', 'cancelled')`

export type AdminDiscountRow = {
  id: string
  name: string
  kind: "automatic" | "coupon"
  valueType: "percentage" | "fixed"
  value: number
  status: "active" | "paused" | "archived"
  startsAt: Date
  endsAt: Date | null
  codeCount: number
  firstCode: string | null
  orders: number
  discountPaise: number
  /** Active but outside its dates. */
  timing: "scheduled" | "ended" | null
}

export const adminListDiscounts = defineOperation({
  name: "discounts.adminList",
  access: { discount: ["read"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    kind: z.enum(["automatic", "coupon"]).optional(),
    status: z.enum(["active", "paused", "archived"]).optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, input) {
    const like = input.q ? `%${input.q.replace(/[%_\\]/g, "\\$&")}%` : null
    const rows = await getDb().execute<{
      id: string
      name: string
      kind: AdminDiscountRow["kind"]
      value_type: AdminDiscountRow["valueType"]
      value: number
      status: AdminDiscountRow["status"]
      starts_at: Date
      ends_at: Date | null
      code_count: number
      first_code: string | null
      orders: number
      discount_paise: number
      timing: AdminDiscountRow["timing"]
      total: number
    }>(sql`
      select d.id, d.name, d.kind, d.value_type, d.value, d.status, d.starts_at, d.ends_at,
             case when d.starts_at > now() then 'scheduled' when d.ends_at <= now() then 'ended' end as timing,
             (select count(*)::int from coupons c where c.discount_id = d.id) as code_count,
             (select c.code::text from coupons c where c.discount_id = d.id order by c.created_at limit 1) as first_code,
             u.orders, u.discount_paise,
             count(*) over ()::int as total
      from discounts d
      left join lateral (
        select count(distinct od.order_id)::int as orders, coalesce(sum(od.amount_paise), 0)::int as discount_paise
        from order_discounts od join orders o on o.id = od.order_id
        where od.discount_id = d.id and ${PLACED}
      ) u on true
      where true
        ${input.kind ? sql`and d.kind = ${input.kind}` : sql``}
        ${input.status ? sql`and d.status = ${input.status}` : sql`and d.status <> 'archived'`}
        ${like ? sql`and (d.name ilike ${like} or exists (select 1 from coupons c where c.discount_id = d.id and c.code::text ilike ${like}))` : sql``}
      order by d.created_at desc
      limit ${ADMIN_DISCOUNTS_PAGE_SIZE} offset ${(input.page - 1) * ADMIN_DISCOUNTS_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r): AdminDiscountRow => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        valueType: r.value_type,
        value: r.value,
        status: r.status,
        startsAt: new Date(r.starts_at),
        endsAt: r.ends_at ? new Date(r.ends_at) : null,
        codeCount: r.code_count,
        firstCode: r.first_code,
        orders: r.orders,
        discountPaise: r.discount_paise,
        timing: r.timing,
      })),
    }
  },
})

export type AdminDiscountDetail = {
  id: string
  /** Sent back on save to catch overlapping edits. */
  version: string
  name: string
  kind: "automatic" | "coupon"
  valueType: "percentage" | "fixed"
  value: number
  maxDiscountPaise: number | null
  minOrderPaise: number
  status: "active" | "paused" | "archived"
  eligibility: DiscountEligibility
  combinable: boolean
  priority: number
  startsAt: Date
  endsAt: Date | null
  usageLimitTotal: number | null
  usageLimitPerCustomer: number | null
  targets: { type: string; id: string; name: string }[]
  codes: { code: string; timesUsed: number; usageLimit: number | null }[]
  codeCount: number
  usage: {
    orders: number
    discountPaise: number
    revenuePaise: number
    recent: {
      orderNumber: string
      customerName: string
      amountPaise: number
      placedAt: Date
    }[]
  }
}

export const adminGetDiscount = defineOperation({
  name: "discounts.adminGet",
  access: { discount: ["read"] },
  input: z.object({ id: z.uuid() }),
  async handler(_ctx, { id }): Promise<AdminDiscountDetail> {
    const db = getDb()
    const found = await db.execute<{
      id: string
      name: string
      kind: AdminDiscountDetail["kind"]
      value_type: AdminDiscountDetail["valueType"]
      value: number
      max_discount_paise: number | null
      min_order_paise: number
      status: AdminDiscountDetail["status"]
      eligibility: DiscountEligibility
      combinable: boolean
      priority: number
      starts_at: Date
      ends_at: Date | null
      usage_limit_total: number | null
      usage_limit_per_customer: number | null
      updated_at: Date
    }>(sql`select * from discounts where id = ${id}`)
    const d = found.rows[0]
    if (!d) throw new DomainError("NOT_FOUND", "Discount not found.")
    const [targets, codes, codeCount, usage, recent] = await Promise.all([
      db.execute<{ type: string; id: string; name: string | null }>(sql`
        select t.target_type as type, t.target_id as id,
          case t.target_type
            when 'product' then (select title from products where id = t.target_id)
            when 'variant' then (select sku::text from product_variants where id = t.target_id)
            when 'category' then (select name from categories where id = t.target_id)
            when 'collection' then (select title from collections where id = t.target_id)
          end as name
        from discount_targets t where t.discount_id = ${id}`),
      db.execute<{
        code: string
        times_used: number
        usage_limit: number | null
      }>(sql`
        select code::text, times_used, usage_limit from coupons where discount_id = ${id}
        order by created_at limit 200`),
      db.execute<{ n: number }>(
        sql`select count(*)::int as n from coupons where discount_id = ${id}`,
      ),
      db.execute<{ orders: number; discount: number; revenue: number }>(sql`
        select count(distinct o.id)::int as orders, coalesce(sum(od.amount_paise), 0)::int as discount,
               coalesce(sum(o.total_paise), 0)::int as revenue
        from order_discounts od join orders o on o.id = od.order_id
        where od.discount_id = ${id} and ${PLACED}`),
      db.execute<{
        order_number: string
        customer_name: string
        amount_paise: number
        placed_at: Date
      }>(sql`
        select o.order_number, o.customer_name, od.amount_paise, o.placed_at
        from order_discounts od join orders o on o.id = od.order_id
        where od.discount_id = ${id} and ${PLACED}
        order by o.placed_at desc limit 20`),
    ])
    return {
      id: d.id,
      version: versionOf(d.updated_at),
      name: d.name,
      kind: d.kind,
      valueType: d.value_type,
      value: d.value,
      maxDiscountPaise: d.max_discount_paise,
      minOrderPaise: d.min_order_paise,
      status: d.status,
      eligibility: d.eligibility ?? {},
      combinable: d.combinable,
      priority: d.priority,
      startsAt: new Date(d.starts_at),
      endsAt: d.ends_at ? new Date(d.ends_at) : null,
      usageLimitTotal: d.usage_limit_total,
      usageLimitPerCustomer: d.usage_limit_per_customer,
      targets: targets.rows.map((t) => ({
        type: t.type,
        id: t.id,
        name: t.name ?? "(deleted)",
      })),
      codes: codes.rows.map((c) => ({
        code: c.code,
        timesUsed: c.times_used,
        usageLimit: c.usage_limit,
      })),
      codeCount: codeCount.rows[0]!.n,
      usage: {
        orders: usage.rows[0]!.orders,
        discountPaise: usage.rows[0]!.discount,
        revenuePaise: usage.rows[0]!.revenue,
        recent: recent.rows.map((r) => ({
          orderNumber: r.order_number,
          customerName: r.customer_name,
          amountPaise: r.amount_paise,
          placedAt: new Date(r.placed_at),
        })),
      },
    }
  },
})

/** Edits a discount. Its kind and codes stay; orders already placed keep their prices. */
export const updateDiscount = defineOperation({
  name: "discounts.update",
  access: { discount: ["update"] },
  input: discountFieldsSchema
    .extend({ id: z.uuid(), expectedVersion: expectedVersionField })
    .refine((d) => d.valueType !== "percentage" || d.value <= 10_000, {
      path: ["value"],
      message: "A percentage is at most 100%.",
    })
    .refine((d) => !d.endsAt || !d.startsAt || d.endsAt > d.startsAt, {
      path: ["endsAt"],
      message: "The end must be after the start.",
    }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      await checkVersion(
        tx,
        "discounts",
        input.id,
        input.expectedVersion,
        "discount",
      )
      const updated = await tx.execute<{ id: string }>(sql`
        update discounts set name = ${input.name}, value_type = ${input.valueType}, value = ${input.value},
          max_discount_paise = ${input.maxDiscountPaise}, min_order_paise = ${input.minOrderPaise},
          applies_to = ${input.targets.length > 0 ? "targets" : "all"},
          eligibility = ${JSON.stringify(input.eligibility)}::jsonb, combinable = ${input.combinable},
          priority = ${input.priority}, starts_at = coalesce(${input.startsAt ?? null}, starts_at),
          ends_at = ${input.endsAt}, usage_limit_total = ${input.usageLimitTotal},
          usage_limit_per_customer = ${input.usageLimitPerCustomer}, updated_at = now()
        where id = ${input.id} and status <> 'archived'
        returning id`)
      if (!updated.rows[0]) {
        throw new DomainError(
          "NOT_FOUND",
          "Discount not found, or it is archived.",
        )
      }
      await tx.execute(
        sql`delete from discount_targets where discount_id = ${input.id}`,
      )
      for (const target of input.targets) {
        await tx.execute(sql`
          insert into discount_targets (discount_id, target_type, target_id)
          values (${input.id}, ${target.type}, ${target.id}) on conflict do nothing`)
      }
      await writeAudit(tx, actor, {
        action: "discount.update",
        entityType: "discount",
        entityId: input.id,
        changes: {
          ...input,
          startsAt: input.startsAt?.toISOString(),
          endsAt: input.endsAt?.toISOString() ?? null,
        },
      })
      return {}
    })
  },
})

export const setDiscountActive = defineOperation({
  name: "discounts.setActive",
  access: { discount: ["update"] },
  input: z.object({ id: z.uuid(), active: z.boolean() }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`
        update discounts set status = ${input.active ? "active" : "paused"}::discount_status, updated_at = now()
        where id = ${input.id} and status <> 'archived' returning id`)
      if (!updated.rows[0])
        throw new DomainError("NOT_FOUND", "Discount not found.")
      await writeAudit(tx, actor, {
        action: input.active ? "discount.resume" : "discount.pause",
        entityType: "discount",
        entityId: input.id,
      })
      return {}
    })
  },
})

export const archiveDiscount = defineOperation({
  name: "discounts.archive",
  access: { discount: ["archive"] },
  input: z.object({ id: z.uuid() }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`
        update discounts set status = 'archived', updated_at = now() where id = ${input.id} returning id`)
      if (!updated.rows[0])
        throw new DomainError("NOT_FOUND", "Discount not found.")
      await writeAudit(tx, actor, {
        action: "discount.archive",
        entityType: "discount",
        entityId: input.id,
      })
      return {}
    })
  },
})

// No 0/O or 1/I/L: codes are read aloud and typed from screenshots.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const randomCode = (prefix: string) =>
  `${prefix}${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`

/** Many unique codes for one coupon discount, single-use by default. */
export const generateCoupons = defineOperation({
  name: "discounts.generateCoupons",
  access: { discount: ["create"] },
  input: z.object({
    discountId: z.uuid(),
    count: z.number().int().min(1).max(1000),
    prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{0,12}$/, "Letters and digits only, up to 12.")
      .default(""),
    usageLimit: z.number().int().min(1).max(1000).nullable().default(1),
  }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const discount = await tx.execute<{ kind: string; status: string }>(
        sql`select kind, status from discounts where id = ${input.discountId} for update`,
      )
      const d = discount.rows[0]
      if (!d) throw new DomainError("NOT_FOUND", "Discount not found.")
      if (d.kind !== "coupon" || d.status === "archived") {
        throw new DomainError(
          "INVALID_STATE",
          "Codes can only be added to a coupon discount that isn't archived.",
        )
      }
      const codes: string[] = []
      for (
        let tries = 0;
        codes.length < input.count && tries < input.count * 3;
        tries += 1
      ) {
        const code = randomCode(input.prefix)
        const inserted = await tx.execute<{ code: string }>(sql`
          insert into coupons (discount_id, code, usage_limit)
          values (${input.discountId}, ${code}, ${input.usageLimit})
          on conflict (code) do nothing returning code::text`)
        if (inserted.rows[0]) codes.push(inserted.rows[0].code)
      }
      await writeAudit(tx, actor, {
        action: "discount.generate_codes",
        entityType: "discount",
        entityId: input.discountId,
        changes: {
          count: codes.length,
          prefix: input.prefix,
          usageLimit: input.usageLimit,
        },
      })
      return { codes }
    })
  },
})

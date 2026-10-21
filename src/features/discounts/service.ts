import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import type { DiscountEligibility } from "@/db/schema"
import type { PricingCoupon, PricingDiscount } from "@/features/pricing"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

/**
 * Promotions (doc/03 §1.2–1.3). Loading and validation happen here; the
 * arithmetic happens in the pricing engine. Usage limits are enforced again
 * under a row lock when an order is placed, so they hold under concurrency.
 */

type Db = Transaction | ReturnType<typeof getDb>

type DiscountRow = {
  id: string
  name: string
  value_type: "percentage" | "fixed"
  value: number
  max_discount_paise: number | null
  min_order_paise: number
  applies_to: "all" | "targets"
  combinable: boolean
  priority: number
  eligibility: DiscountEligibility
  usage_limit_total: number | null
  usage_limit_per_customer: number | null
  targets:
    { type: PricingDiscount["targets"][number]["type"]; id: string }[] | null
}

const SELECT_DISCOUNT = sql`
  select d.id, d.name, d.value_type, d.value, d.max_discount_paise, d.min_order_paise,
         d.applies_to, d.combinable, d.priority, d.eligibility,
         d.usage_limit_total, d.usage_limit_per_customer,
         (select json_agg(json_build_object('type', t.target_type, 'id', t.target_id))
          from discount_targets t where t.discount_id = d.id) as targets
  from discounts d`

const LIVE = sql`d.status = 'active' and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())`

function toPricing(row: DiscountRow): PricingDiscount {
  return {
    id: row.id,
    name: row.name,
    valueType: row.value_type,
    value: row.value,
    maxDiscountPaise: row.max_discount_paise,
    minOrderPaise: row.min_order_paise,
    appliesTo: row.applies_to,
    targets: row.targets ?? [],
    combinable: row.combinable,
    priority: row.priority,
  }
}

export async function loadAutomaticDiscounts(
  db: Db,
): Promise<PricingDiscount[]> {
  const result = await db.execute<DiscountRow>(
    sql`${SELECT_DISCOUNT} where d.kind = 'automatic' and ${LIVE}`,
  )
  return result.rows.map(toPricing)
}

/**
 * The coupon for this customer, or the reason it can't be used. Callers
 * show the reason next to the coupon field; the order can still proceed.
 */
export async function findUsableCoupon(
  db: Db,
  code: string,
  userId: string,
): Promise<{ coupon: PricingCoupon } | { error: string }> {
  const normalised = code.trim()
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(normalised))
    return { error: "That coupon code isn't valid." }
  const result = await db.execute<
    DiscountRow & {
      coupon_id: string
      code: string
      times_used: number
      code_limit: number | null
      discount_used: number
      live: boolean
    }
  >(sql`
    select c.id as coupon_id, c.code::text as code, c.times_used, c.usage_limit as code_limit,
           (select coalesce(sum(times_used), 0)::int from coupons where discount_id = c.discount_id) as discount_used,
           (${LIVE}) as live, x.*
    from coupons c
    join lateral (${SELECT_DISCOUNT} where d.id = c.discount_id and d.kind = 'coupon') x on true
    join discounts d on d.id = c.discount_id
    where c.code = ${normalised}`)
  const row = result.rows[0]
  if (!row || !row.live)
    return { error: "That coupon code isn't valid or has expired." }
  if (
    (row.usage_limit_total !== null &&
      row.discount_used >= row.usage_limit_total) ||
    (row.code_limit !== null && row.times_used >= row.code_limit)
  ) {
    return { error: "This coupon has been fully used." }
  }
  if (row.usage_limit_per_customer !== null) {
    // Per customer across all of the discount's codes.
    const used = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from coupon_redemptions r join coupons c on c.id = r.coupon_id
      where c.discount_id = ${row.id} and r.user_id = ${userId} and r.status = 'active'`)
    if (used.rows[0]!.n >= row.usage_limit_per_customer) {
      return { error: "You've already used this coupon." }
    }
  }
  const eligibility = row.eligibility ?? {}
  if (eligibility.userIds && !eligibility.userIds.includes(userId)) {
    return { error: "This coupon isn't available on your account." }
  }
  if (eligibility.phoneVerifiedOnly) {
    const phone = await db.execute<{ ok: boolean }>(
      sql`select coalesce(phone_number_verified, false) as ok from users where id = ${userId}`,
    )
    if (!phone.rows[0]?.ok)
      return { error: "Verify your mobile number to use this coupon." }
  }
  if (eligibility.firstOrderOnly) {
    const orders = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from orders
      where user_id = ${userId} and status not in ('pending_payment', 'expired', 'cancelled')`)
    if (orders.rows[0]!.n > 0)
      return { error: "This coupon is for your first order only." }
  }
  return {
    coupon: { ...toPricing(row), couponId: row.coupon_id, code: row.code },
  }
}

/** Redeems a coupon for an order inside the order's transaction. */
export async function redeemCoupon(
  tx: Transaction,
  input: {
    couponId: string
    orderId: string
    userId: string
    amountPaise: number
  },
): Promise<void> {
  // The discount row is locked too: its total limit spans all its codes.
  // NO KEY UPDATE, not UPDATE: the order's discount lines were inserted
  // earlier in this transaction, and their foreign keys hold KEY SHARE locks
  // on these rows in every competing checkout. FOR UPDATE conflicts with
  // those and deadlocked concurrent checkouts; NO KEY UPDATE still lets only
  // one redemption run at a time (race test M1).
  const locked = await tx.execute<{
    times_used: number
    code_limit: number | null
    discount_id: string
    usage_limit_total: number | null
    usage_limit_per_customer: number | null
  }>(sql`
    select c.times_used, c.usage_limit as code_limit, c.discount_id, d.usage_limit_total, d.usage_limit_per_customer
    from coupons c join discounts d on d.id = c.discount_id
    where c.id = ${input.couponId}
    for no key update of c, d`)
  const row = locked.rows[0]
  if (!row)
    throw new DomainError("CONFLICT", "That coupon is no longer available.")
  const discountUsed =
    row.usage_limit_total === null
      ? 0
      : (
          await tx.execute<{ n: number }>(
            sql`select coalesce(sum(times_used), 0)::int as n from coupons where discount_id = ${row.discount_id}`,
          )
        ).rows[0]!.n
  if (
    (row.usage_limit_total !== null && discountUsed >= row.usage_limit_total) ||
    (row.code_limit !== null && row.times_used >= row.code_limit)
  ) {
    throw new DomainError(
      "CONFLICT",
      "This coupon has just been fully used. Please review your order.",
    )
  }
  if (row.usage_limit_per_customer !== null) {
    const used = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from coupon_redemptions r join coupons c on c.id = r.coupon_id
      where c.discount_id = ${row.discount_id} and r.user_id = ${input.userId} and r.status = 'active'`)
    if (used.rows[0]!.n >= row.usage_limit_per_customer) {
      throw new DomainError("CONFLICT", "You've already used this coupon.")
    }
  }
  await tx.execute(
    sql`update coupons set times_used = times_used + 1, updated_at = now() where id = ${input.couponId}`,
  )
  await tx.execute(sql`
    insert into coupon_redemptions (coupon_id, order_id, user_id, amount_paise)
    values (${input.couponId}, ${input.orderId}, ${input.userId}, ${input.amountPaise})`)
}

/** Gives a coupon use back (order expired or cancelled). Idempotent. */
export async function reverseCouponRedemption(
  tx: Transaction,
  orderId: string,
): Promise<boolean> {
  const reversed = await tx.execute<{ coupon_id: string }>(sql`
    update coupon_redemptions set status = 'reversed', updated_at = now()
    where order_id = ${orderId} and status = 'active'
    returning coupon_id`)
  const row = reversed.rows[0]
  if (!row) return false
  await tx.execute(sql`
    update coupons set times_used = greatest(times_used - 1, 0), updated_at = now()
    where id = ${row.coupon_id}`)
  return true
}

// --- Staff operations (the admin UI arrives in Phase 4) ----------------------------

/** The editable fields of a discount (create and update share them). */
export const discountFieldsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  valueType: z.enum(["percentage", "fixed"]),
  value: z.number().int().positive(),
  maxDiscountPaise: z.number().int().positive().nullable().default(null),
  minOrderPaise: z.number().int().min(0).default(0),
  targets: z
    .array(
      z.object({
        type: z.enum(["product", "variant", "category", "collection"]),
        id: z.uuid(),
      }),
    )
    .max(500)
    .default([]),
  eligibility: z
    .object({
      firstOrderOnly: z.boolean().optional(),
      phoneVerifiedOnly: z.boolean().optional(),
      userIds: z.array(z.uuid()).max(1000).optional(),
    })
    .default({}),
  combinable: z.boolean().default(false),
  priority: z.number().int().min(0).max(1000).default(0),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().default(null),
  usageLimitTotal: z.number().int().positive().nullable().default(null),
  usageLimitPerCustomer: z.number().int().positive().nullable().default(null),
})

export const createDiscountSchema = discountFieldsSchema
  .extend({
    kind: z.enum(["automatic", "coupon"]),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,32}$/)
      .optional(),
  })
  .refine((d) => d.valueType !== "percentage" || d.value <= 10_000, {
    path: ["value"],
    message: "A percentage is at most 100% (10000 basis points).",
  })
  .refine((d) => (d.kind === "coupon") === Boolean(d.code), {
    path: ["code"],
    message: "Coupons need a code; automatic discounts must not have one.",
  })

export const createDiscount = defineOperation({
  name: "discounts.create",
  access: { discount: ["create"] },
  input: createDiscountSchema,
  async handler({ actor }, input) {
    try {
      return await withTransaction(async (tx) => {
        const created = await tx.execute<{ id: string }>(sql`
          insert into discounts (name, kind, value_type, value, max_discount_paise, min_order_paise,
                                 applies_to, eligibility, combinable, priority, starts_at, ends_at,
                                 usage_limit_total, usage_limit_per_customer)
          values (${input.name}, ${input.kind}, ${input.valueType}, ${input.value}, ${input.maxDiscountPaise},
                  ${input.minOrderPaise}, ${input.targets.length > 0 ? "targets" : "all"},
                  ${JSON.stringify(input.eligibility)}::jsonb, ${input.combinable}, ${input.priority},
                  ${input.startsAt ?? new Date()}, ${input.endsAt}, ${input.usageLimitTotal},
                  ${input.usageLimitPerCustomer})
          returning id`)
        const id = created.rows[0]!.id
        for (const target of input.targets) {
          await tx.execute(sql`
            insert into discount_targets (discount_id, target_type, target_id)
            values (${id}, ${target.type}, ${target.id}) on conflict do nothing`)
        }
        if (input.code) {
          await tx.execute(
            sql`insert into coupons (discount_id, code) values (${id}, ${input.code})`,
          )
        }
        await writeAudit(tx, actor, {
          action: "discount.create",
          entityType: "discount",
          entityId: id,
          changes: {
            ...input,
            startsAt: input.startsAt?.toISOString(),
            endsAt: input.endsAt?.toISOString(),
          },
        })
        return { id }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError("CONFLICT", "That coupon code is already in use.")
      }
      throw error
    }
  },
})

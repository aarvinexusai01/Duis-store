import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { addCartItem } from "@/features/cart"
import { getCheckoutQuote } from "@/features/checkout"
import {
  adminGetCustomer,
  adminListCustomers,
  setCodBlock,
} from "@/features/customers"
import {
  adminGetDiscount,
  adminListDiscounts,
  createDiscount,
  generateCoupons,
  setDiscountActive,
  updateDiscount,
} from "@/features/discounts"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { createUserActor, unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { buyer, code, paidOrder, sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

let variantId: string
let admin: Actor
let support: Actor

beforeAll(async () => {
  ;({ variantId } = await sellableProduct())
  admin = await createUserActor("store_admin")
  support = await createUserActor("support_agent")
})

describe("customers", () => {
  it("lists customers, not staff, and hides spend from support", async () => {
    const customer = await buyer()
    await paidOrder(customer, variantId)
    const { rows } = await getDb().execute<{ email: string }>(
      sql`select email from users where id = ${customer.userId}`,
    )
    const forAdmin = await adminListCustomers(admin, { q: rows[0]!.email })
    expect(forAdmin.rows).toHaveLength(1)
    expect(forAdmin.rows[0]).toMatchObject({ orderCount: 1 })
    expect(forAdmin.rows[0]!.spentPaise).toBeGreaterThan(0)
    const forSupport = await adminListCustomers(support, { q: rows[0]!.email })
    expect(forSupport.rows[0]!.spentPaise).toBeNull()
    const staff = await adminListCustomers(admin, { q: "store_admin-" })
    expect(staff.rows).toHaveLength(0)
  })

  it("blocks cash on delivery with a reason, which checkout then refuses", async () => {
    const customer = await buyer()
    await addCartItem(customer, { variantId, quantity: 1 })
    const choices = {
      addressId: customer.addressId,
      paymentMode: "partial_cod" as const,
      useWallet: false,
    }
    expect((await getCheckoutQuote(customer, choices)).codAvailable).toBe(true)
    expect(
      await code(
        setCodBlock(support, { userId: customer.userId, blocked: true }),
      ),
    ).toBe("VALIDATION_FAILED")
    await setCodBlock(support, {
      userId: customer.userId,
      blocked: true,
      reason: "refused two parcels",
    })
    expect((await getCheckoutQuote(customer, choices)).codAvailable).toBe(false)
    const detail = await adminGetCustomer(support, { userId: customer.userId })
    expect(detail).toMatchObject({
      codBlocked: true,
      codBlockedReason: "refused two parcels",
    })
    const audit = await getDb().execute(sql`
      select 1 from audit_logs where entity_id = ${customer.userId} and action = 'customer.block_cod'`)
    expect(audit.rows).toHaveLength(1)
  })
})

describe("discounts", () => {
  it("generates single-use codes that each work once", async () => {
    const { id } = await createDiscount(admin, {
      name: unique("Influencer"),
      kind: "coupon",
      code: unique("INF").replace(/-/g, "").toUpperCase(),
      valueType: "fixed",
      value: 5_000,
    })
    const { codes } = await generateCoupons(admin, {
      discountId: id,
      count: 3,
      prefix: "TEST",
    })
    expect(codes).toHaveLength(3)
    expect(new Set(codes).size).toBe(3)
    expect(codes[0]).toMatch(/^TEST[A-Z2-9]{8}$/)

    await paidOrder(await buyer(), variantId, { couponCode: codes[0] })
    const second = await buyer()
    await addCartItem(second, { variantId, quantity: 1 })
    const quote = await getCheckoutQuote(second, {
      addressId: second.addressId,
      paymentMode: "prepaid",
      useWallet: false,
      couponCode: codes[0],
    })
    expect(quote.couponError).toMatch(/fully used/)

    const detail = await adminGetDiscount(admin, { id })
    expect(detail.codeCount).toBe(4)
    expect(detail.usage.orders).toBe(1)
    expect(detail.usage.discountPaise).toBe(5_000)
  })

  it("edits, pauses and lists discounts, with an audit trail", async () => {
    const name = unique("Weekend")
    const { id } = await createDiscount(admin, {
      name,
      kind: "automatic",
      valueType: "percentage",
      value: 1_000,
    })
    await updateDiscount(admin, {
      id,
      name,
      valueType: "percentage",
      value: 1_500,
      maxDiscountPaise: 20_000,
    })
    expect(await adminGetDiscount(admin, { id })).toMatchObject({
      value: 1_500,
      maxDiscountPaise: 20_000,
    })
    await setDiscountActive(admin, { id, active: false })
    const list = await adminListDiscounts(admin, { q: name })
    expect(list.rows[0]).toMatchObject({ status: "paused", kind: "automatic" })
    expect(await code(setDiscountActive(support, { id, active: true }))).toBe(
      "FORBIDDEN",
    )
    const audit = await getDb().execute<{ action: string }>(sql`
      select action from audit_logs where entity_id = ${id} order by created_at`)
    expect(audit.rows.map((r) => r.action)).toEqual([
      "discount.create",
      "discount.update",
      "discount.pause",
    ])
  })
})

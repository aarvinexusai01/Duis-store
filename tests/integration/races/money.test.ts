import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createDiscount, generateCoupons } from "@/features/discounts"
import { expirePendingOrders } from "@/features/orders"
import { creditWallet, spendableBalance } from "@/features/wallet"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"

import { asSystem, unique } from "../../helpers/actors"
import { closeConnectionsAfterAll } from "../../helpers/cleanup"
import {
  callback,
  capture,
  count,
  expectInvariants,
  newCustomers,
  orderByNumber,
  prepareOrder,
  race,
  RUNS,
  variantWithStock,
  type Buyer,
} from "./support"

closeConnectionsAfterAll()
afterAll(expectInvariants)

const runs = Array.from({ length: RUNS }, (_, i) => i + 1)
const db = () => getDb()

let variantId: string
beforeAll(async () => {
  variantId = await variantWithStock(500)
})

/** A ₹100-off coupon with the given limits; returns its code. */
async function coupon(
  limits: { total?: number; perCustomer?: number } = {},
): Promise<{ code: string; discountId: string }> {
  const code = unique("RACE").replace(/-/g, "").toUpperCase()
  const { id } = await createDiscount(asSystem(), {
    name: code,
    kind: "coupon",
    code,
    valueType: "fixed",
    value: 10_000,
    usageLimitTotal: limits.total ?? null,
    usageLimitPerCustomer: limits.perCustomer ?? null,
  })
  return { code, discountId: id }
}

async function timesUsed(code: string): Promise<number> {
  const { rows } = await db().execute<{ times_used: number }>(
    sql`select times_used from coupons where code = ${code}`,
  )
  return rows[0]!.times_used
}

async function giveCredit(customer: Buyer, amountPaise: number) {
  await withTransaction((tx) =>
    creditWallet(tx, {
      userId: customer.userId,
      amountPaise,
      reason: "goodwill",
      idempotencyKey: `race:${randomUUID()}`,
    }),
  )
}

/** Every losing request must fail with a domain error, never a crash. */
function expectCleanLosers(outcomes: string[]) {
  for (const outcome of outcomes) {
    expect(outcome).toMatch(/^(ok|CONFLICT|VALIDATION_FAILED|INVALID_STATE)$/)
  }
}

describe("M1–M3: coupon limits", () => {
  it.each(runs)(
    "M1: a coupon with one use left, 3 customers at once: one redemption (run %i)",
    async () => {
      const { code } = await coupon({ total: 1 })
      const orders = await Promise.all(
        (await newCustomers(3)).map((c) =>
          prepareOrder(c, variantId, { couponCode: code }),
        ),
      )
      const outcomes = await race(orders.map((o) => o.place))
      expect(count(outcomes, "ok")).toBe(1)
      expectCleanLosers(outcomes)
      expect(await timesUsed(code)).toBe(1)
    },
  )

  it.each(runs)(
    "M2: one use per customer, the same customer in two tabs: one redemption (run %i)",
    async () => {
      const { code } = await coupon({ perCustomer: 1 })
      const [customer] = await newCustomers(1)
      const tab = await prepareOrder(customer!, variantId, { couponCode: code })
      const outcomes = await race([tab.place, tab.place])
      expect(count(outcomes, "ok")).toBe(1)
      expectCleanLosers(outcomes)
      expect(await timesUsed(code)).toBe(1)
    },
  )

  it.each(runs)(
    "M3: a single-use code typed by two customers at once: one redemption (run %i)",
    async () => {
      const { discountId } = await coupon()
      const {
        codes: [single],
      } = await generateCoupons(asSystem(), {
        discountId,
        count: 1,
        prefix: "ONE",
      })
      const orders = await Promise.all(
        (await newCustomers(2)).map((c) =>
          prepareOrder(c, variantId, { couponCode: single }),
        ),
      )
      const outcomes = await race(orders.map((o) => o.place))
      expect(count(outcomes, "ok")).toBe(1)
      expectCleanLosers(outcomes)
      expect(await timesUsed(single!)).toBe(1)
    },
  )
})

describe("M4: wallet credit", () => {
  it.each(runs)(
    "M4: the same ₹500 spent by two orders at once: one succeeds, never negative (run %i)",
    async () => {
      const [customer] = await newCustomers(1)
      await giveCredit(customer!, 50_000)
      const tab = await prepareOrder(customer!, variantId, {
        useWallet: true,
      })
      const outcomes = await race([tab.place, tab.place])
      expect(count(outcomes, "ok")).toBe(1)
      expectCleanLosers(outcomes)
      expect(await spendableBalance(db(), customer!.userId)).toBe(0)
      const debits = await db().execute<{ total: number }>(sql`
        select coalesce(sum(amount_paise), 0)::int as total from wallet_ledger
        where user_id = ${customer!.userId} and reason = 'order_payment'`)
      expect(debits.rows[0]!.total).toBe(-50_000)
    },
  )
})

describe("M5–M6: releasing what an unpaid order held", () => {
  /** An unpaid order holding wallet credit and a one-use coupon. */
  async function heldOrder() {
    const { code } = await coupon({ total: 1 })
    const [customer] = await newCustomers(1)
    await giveCredit(customer!, 20_000)
    const placed = await (
      await prepareOrder(customer!, variantId, {
        couponCode: code,
        useWallet: true,
      })
    ).place()
    expect(await spendableBalance(db(), customer!.userId)).toBe(0)
    expect(await timesUsed(code)).toBe(1)
    await db().execute(sql`
      update orders set reservation_expires_at = now() - interval '5 minutes' where order_number = ${placed.orderNumber}`)
    return { customer: customer!, placed, code }
  }

  it.each(runs)(
    "M5: the expiry job running twice at once gives credit and coupon back once (run %i)",
    async () => {
      const { customer, placed, code } = await heldOrder()
      const outcomes = await race([
        () => expirePendingOrders(),
        () => expirePendingOrders(),
      ])
      expect(outcomes).toEqual(["ok", "ok"])
      expect((await orderByNumber(placed.orderNumber)).status).toBe("expired")
      expect(await spendableBalance(db(), customer.userId)).toBe(20_000)
      expect(await timesUsed(code)).toBe(0)
    },
  )

  it.each(runs)(
    "M6: expiry and a late payment at once: the coupon and credit are used once or not at all (run %i)",
    async () => {
      const { customer, placed, code } = await heldOrder()
      const paid = await capture(customer, placed)
      const outcomes = await race([
        () => expirePendingOrders(),
        () => callback(customer, paid),
      ])
      expect(outcomes).toEqual(["ok", "ok"])
      const order = await orderByNumber(placed.orderNumber)
      if (order.status === "confirmed") {
        expect(await timesUsed(code)).toBe(1)
        expect(await spendableBalance(db(), customer.userId)).toBe(0)
      } else {
        expect(order.status).toMatch(/expired|cancelled/)
        expect(await timesUsed(code)).toBe(0)
        expect(await spendableBalance(db(), customer.userId)).toBe(20_000)
      }
    },
  )
})

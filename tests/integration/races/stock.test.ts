import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { approveExchange, requestExchange } from "@/features/exchanges"
import { adjustStock } from "@/features/inventory"
import {
  createShipments,
  expirePendingOrders,
  simulateTracking,
} from "@/features/orders"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { asSystem, createUserActor } from "../../helpers/actors"
import { closeConnectionsAfterAll } from "../../helpers/cleanup"
import { paidOrder } from "../../helpers/shop"
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
  stockOf,
  variantWithStock,
  raceProduct,
} from "./support"

closeConnectionsAfterAll()
afterAll(expectInvariants)

const runs = Array.from({ length: RUNS }, (_, i) => i + 1)

/** Lets the order's reservation run out, then runs the expiry job. */
async function expire(orderNumber: string) {
  await getDb().execute(sql`
    update orders set reservation_expires_at = now() - interval '5 minutes' where order_number = ${orderNumber}`)
  await expirePendingOrders()
  expect((await orderByNumber(orderNumber)).status).toBe("expired")
}

describe("S1–S3: customers racing for the last units", () => {
  it.each(runs)("S1: 3 customers, 1 unit: one order (run %i)", async () => {
    const variantId = await variantWithStock(1)
    const orders = await Promise.all(
      (await newCustomers(3)).map((c) => prepareOrder(c, variantId)),
    )
    const outcomes = await race(orders.map((o) => o.place))
    expect(count(outcomes, "ok")).toBe(1)
    expect(count(outcomes, "OUT_OF_STOCK")).toBe(2)
    expect(await stockOf(variantId)).toEqual({ on_hand: 1, reserved: 1 })
  })

  it.each(runs)("S2: 20 customers, 1 unit: one order (run %i)", async () => {
    const variantId = await variantWithStock(1)
    const orders = await Promise.all(
      (await newCustomers(20)).map((c) => prepareOrder(c, variantId)),
    )
    const outcomes = await race(orders.map((o) => o.place))
    expect(count(outcomes, "ok")).toBe(1)
    expect(count(outcomes, "OUT_OF_STOCK")).toBe(19)
    expect((await stockOf(variantId)).reserved).toBe(1)
  })

  it.each(runs)(
    "S3: 2 units, one customer wants 2 and two want 1: never more than 2 (run %i)",
    async () => {
      const variantId = await variantWithStock(2)
      const [big, a, b] = await newCustomers(3)
      const orders = [
        await prepareOrder(big!, variantId, { quantity: 2 }),
        await prepareOrder(a!, variantId),
        await prepareOrder(b!, variantId),
      ]
      const outcomes = await race(orders.map((o) => o.place))
      const sold =
        (outcomes[0] === "ok" ? 2 : 0) +
        (outcomes[1] === "ok" ? 1 : 0) +
        (outcomes[2] === "ok" ? 1 : 0)
      expect(sold).toBe((await stockOf(variantId)).reserved)
      expect(sold).toBeLessThanOrEqual(2)
      expect(sold).toBeGreaterThan(0)
      expect(outcomes.every((o) => o === "ok" || o === "OUT_OF_STOCK")).toBe(
        true,
      )
    },
  )
})

describe("S4–S5: payment arriving after the reservation ran out", () => {
  it.each(runs)(
    "S4: late payment races a new buyer for the last unit: one keeps it, the other is refunded (run %i)",
    async () => {
      const variantId = await variantWithStock(1)
      const [late, other] = await newCustomers(2)
      const first = await prepareOrder(late!, variantId)
      const placed = await first.place()
      await expire(placed.orderNumber)
      // A pays after the expiry; B is checking out for the freed unit.
      const paid = await capture(late!, placed)
      const second = await prepareOrder(other!, variantId)
      let secondNumber = ""
      const outcomes = await race([
        () => callback(late!, paid),
        async () => {
          const result = await second.place()
          secondNumber = result.orderNumber
        },
      ])
      expect(outcomes[0]).toBe("ok")
      const lateOrder = await orderByNumber(placed.orderNumber)
      if (lateOrder.status === "confirmed") {
        // A's payment re-reserved and committed the unit first: B was told
        // it sold out.
        expect(outcomes[1]).toBe("OUT_OF_STOCK")
        expect(await stockOf(variantId)).toEqual({ on_hand: 0, reserved: 0 })
      } else {
        // B holds the unit: A's order is cancelled and the money goes back
        // in full (the customer is emailed why).
        expect(outcomes[1]).toBe("ok")
        expect(secondNumber).not.toBe("")
        expect(lateOrder.status).toBe("cancelled")
        const refunds = await getDb().execute<{ amount_paise: number }>(sql`
          select amount_paise from refunds where order_id = ${lateOrder.id}`)
        expect(refunds.rows.map((r) => r.amount_paise)).toEqual([
          paid.amountPaise,
        ])
        expect(await stockOf(variantId)).toEqual({ on_hand: 1, reserved: 1 })
      }
      await expectInvariants()
    },
  )

  it("S5: late payment with stock still there confirms the order", async () => {
    const variantId = await variantWithStock(5)
    const [late] = await newCustomers(1)
    const placed = await (await prepareOrder(late!, variantId)).place()
    await expire(placed.orderNumber)
    const paid = await capture(late!, placed)
    expect(await callback(late!, paid)).toEqual({ status: "confirmed" })
    expect((await orderByNumber(placed.orderNumber)).status).toBe("confirmed")
    expect(await stockOf(variantId)).toEqual({ on_hand: 4, reserved: 0 })
  })
})

describe("S6: staff remove stock while customers check out", () => {
  it.each(runs)(
    "S6: stock never goes below what is reserved (run %i)",
    async () => {
      const variantId = await variantWithStock(3)
      const orders = await Promise.all(
        (await newCustomers(3)).map((c) => prepareOrder(c, variantId)),
      )
      const outcomes = await race([
        () =>
          adjustStock(asSystem(), {
            variantId,
            delta: -3,
            reason: "damaged",
          }),
        ...orders.map((o) => o.place),
      ])
      const [adjusted, ...placed] = outcomes
      const sold = count(placed, "ok")
      const after = await stockOf(variantId)
      if (adjusted === "ok") {
        // The stock was written off before any order reserved it.
        expect(sold).toBe(0)
        expect(after).toEqual({ on_hand: 0, reserved: 0 })
      } else {
        // At least one order held stock first, so the write-off was refused.
        expect(sold).toBeGreaterThan(0)
        expect(after).toEqual({ on_hand: 3, reserved: sold })
      }
      expect(placed.every((o) => o === "ok" || o === "OUT_OF_STOCK")).toBe(true)
    },
  )
})

describe("S7: two exchanges for the last replacement size", () => {
  let support: Actor
  let packer: Actor
  let admin: Actor
  beforeAll(async () => {
    support = await createUserActor("support_agent")
    packer = await createUserActor("fulfilment_staff")
    admin = await createUserActor("store_admin")
  })

  async function deliveredOrder(
    customer: Awaited<ReturnType<typeof newCustomers>>[number],
    variantId: string,
  ) {
    const number = await paidOrder(customer, variantId)
    await createShipments(admin, { orderNumbers: [number] })
    const { rows } = await getDb().execute<{ id: string }>(sql`
      select s.id from shipments s join orders o on o.id = s.order_id where o.order_number = ${number}`)
    for (let i = 0; i < 4; i += 1) {
      await simulateTracking(packer, {
        shipmentId: rows[0]!.id,
        outcome: "next",
      })
    }
    const item = await getDb().execute<{ id: string }>(sql`
      select oi.id from order_items oi join orders o on o.id = oi.order_id where o.order_number = ${number}`)
    return { number, itemId: item.rows[0]!.id }
  }

  it.each(runs)(
    "S7: one approval gets the unit, the other is told it's unavailable (run %i)",
    async () => {
      const { productId } = await raceProduct()
      const variants = await getDb().execute<{ id: string; sig: string }>(sql`
        select id, option_signature as sig from product_variants where product_id = ${productId}`)
      const byKey = Object.fromEntries(variants.rows.map((v) => [v.sig, v.id]))
      const bought = byKey["color=black;size=m"]!
      const wanted = byKey["color=black;size=l"]!
      await adjustStock(asSystem(), {
        variantId: bought,
        delta: 5,
        reason: "receive",
      })
      await adjustStock(asSystem(), {
        variantId: wanted,
        delta: 1,
        reason: "receive",
      })

      const customers = await newCustomers(2)
      const exchanges: string[] = []
      for (const customer of customers) {
        const order = await deliveredOrder(customer, bought)
        const { exchangeNumber } = await requestExchange(customer, {
          orderNumber: order.number,
          orderItemId: order.itemId,
          variantId: wanted,
          quantity: 1,
          reason: "too_small",
        })
        exchanges.push(exchangeNumber)
      }
      const outcomes = await race(
        exchanges.map(
          (exchangeNumber) => () =>
            approveExchange(support, { exchangeNumber }),
        ),
      )
      expect(count(outcomes, "ok")).toBe(1)
      expect(outcomes.filter((o) => o !== "ok")).toEqual([
        expect.stringMatching(/OUT_OF_STOCK|INVALID_STATE|CONFLICT/),
      ])
      expect(await stockOf(wanted)).toEqual({ on_hand: 1, reserved: 1 })
    },
  )
})

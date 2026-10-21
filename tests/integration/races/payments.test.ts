import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startPayment } from "@/features/checkout"
import {
  cancelOrder,
  createShipments,
  expirePendingOrders,
  processWebhookEvent,
  reconcilePendingPayments,
  recordWebhook,
  refundOrder,
} from "@/features/orders"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { createUserActor } from "../../helpers/actors"
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
  stockOf,
  variantWithStock,
} from "./support"

closeConnectionsAfterAll()
afterAll(expectInvariants)

const runs = Array.from({ length: RUNS }, (_, i) => i + 1)
const db = () => getDb()

let variantId: string
let admin: Actor
let support: Actor
beforeAll(async () => {
  variantId = await variantWithStock(500)
  admin = await createUserActor("store_admin")
  support = await createUserActor("support_agent")
})

/** A placed, unpaid order and its customer. */
async function unpaidOrder() {
  const [customer] = await newCustomers(1)
  const placed = await (await prepareOrder(customer!, variantId)).place()
  return { customer: customer!, placed }
}

/** The gateway's webhook for a captured payment, recorded but not processed. */
function webhookFor(paid: Awaited<ReturnType<typeof capture>>) {
  return {
    provider: "fake",
    eventId: `evt_${randomUUID()}`,
    eventType: "payment.captured",
    payload: {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paid.providerPaymentId,
            order_id: paid.providerOrderId,
            status: "captured",
            amount: paid.amountPaise,
            currency: "INR",
            method: "upi",
          },
        },
      },
    },
  }
}

async function webhookId(eventId: string) {
  const { rows } = await db().execute<{ id: string }>(
    sql`select id from webhook_events where event_id = ${eventId}`,
  )
  return rows[0]!.id
}

/** Confirmed exactly once: one status change, one email, one stock commit. */
async function expectConfirmedOnce(orderNumber: string) {
  const order = await orderByNumber(orderNumber)
  expect(order).toMatchObject({ status: "confirmed", payment_status: "paid" })
  const facts = await db().execute<{
    confirmations: number
    emails: number
    commits: number
    refunds: number
  }>(sql`
    select
      (select count(*)::int from order_status_history where order_id = ${order.id} and field = 'status' and to_value = 'confirmed') as confirmations,
      (select count(*)::int from notification_logs where reference_id = ${order.id} and template = 'order-confirmed') as emails,
      (select count(*)::int from inventory_movements where reference_type = 'order' and reference_id = ${order.id}) as commits,
      (select count(*)::int from refunds where order_id = ${order.id}) as refunds`)
  expect(facts.rows[0]).toEqual({
    confirmations: 1,
    emails: 1,
    commits: 1,
    refunds: 0,
  })
}

describe("P1–P2: the same payment reported more than once", () => {
  it.each(runs)(
    "P1: webhook and browser confirmation at the same instant confirm once (run %i)",
    async () => {
      const { customer, placed } = await unpaidOrder()
      const paid = await capture(customer, placed)
      const hook = webhookFor(paid)
      const outcomes = await race([
        () => callback(customer, paid),
        async () => {
          await recordWebhook(hook)
          await processWebhookEvent(await webhookId(hook.eventId))
        },
      ])
      expect(outcomes).toEqual(["ok", "ok"])
      await expectConfirmedOnce(placed.orderNumber)
    },
  )

  it.each(runs)(
    "P2: the same webhook delivered 5 times at once is processed once (run %i)",
    async () => {
      const { customer, placed } = await unpaidOrder()
      const paid = await capture(customer, placed)
      const hook = webhookFor(paid)
      const stored = await Promise.all(
        Array.from({ length: 5 }, () => recordWebhook(hook)),
      )
      expect(stored.filter(Boolean)).toHaveLength(1)
      const id = await webhookId(hook.eventId)
      const outcomes = await race(
        Array.from({ length: 5 }, () => () => processWebhookEvent(id)),
      )
      expect(count(outcomes, "ok")).toBe(5)
      await expectConfirmedOnce(placed.orderNumber)
    },
  )
})

describe("P3: Pay pressed twice", () => {
  it.each(runs)(
    "P3: one gateway order; a second captured payment is refunded (run %i)",
    async () => {
      const { customer, placed } = await unpaidOrder()
      const starts = await Promise.all([
        startPayment(customer, { orderNumber: placed.orderNumber }),
        startPayment(customer, { orderNumber: placed.orderNumber }),
      ])
      expect(starts[0]!.providerOrderId).toBe(starts[1]!.providerOrderId)

      // Two tabs both completed the hosted checkout.
      const first = await capture(customer, placed)
      const second = await capture(customer, placed)
      const outcomes = await race([
        () => callback(customer, first),
        () => callback(customer, second),
      ])
      expect(outcomes).toEqual(["ok", "ok"])
      const order = await orderByNumber(placed.orderNumber)
      expect(order.status).toBe("confirmed")
      const refunds = await db().execute<{ amount_paise: number }>(
        sql`select amount_paise from refunds where order_id = ${order.id}`,
      )
      expect(refunds.rows.map((r) => r.amount_paise)).toEqual([
        first.amountPaise,
      ])
    },
  )
})

describe("P4: cancelling while something else happens", () => {
  it.each(runs)(
    "P4: cancel while the payment captures: confirmed, or cancelled with a refund (run %i)",
    async () => {
      const { customer, placed } = await unpaidOrder()
      const paid = await capture(customer, placed)
      const outcomes = await race([
        () => callback(customer, paid),
        () => cancelOrder(customer, { orderNumber: placed.orderNumber }),
      ])
      expect(outcomes[0]).toBe("ok")
      const order = await orderByNumber(placed.orderNumber)
      if (outcomes[1] === "ok") {
        expect(order.status).toBe("cancelled")
        const refunds = await db().execute<{ amount_paise: number }>(
          sql`select amount_paise from refunds where order_id = ${order.id}`,
        )
        expect(refunds.rows.map((r) => r.amount_paise)).toEqual([
          paid.amountPaise,
        ])
      } else {
        // An unpaid order can't be cancelled by the customer.
        expect(outcomes[1]).toBe("INVALID_STATE")
        expect(order.status).toBe("confirmed")
      }
    },
  )

  it.each(runs)(
    "P4b: customer cancels while staff book the parcel: one of the two wins (run %i)",
    async () => {
      const { customer, placed } = await unpaidOrder()
      await callback(customer, await capture(customer, placed))
      const before = await stockOf(variantId)
      const outcomes = await race([
        () => cancelOrder(customer, { orderNumber: placed.orderNumber }),
        () => createShipments(admin, { orderNumbers: [placed.orderNumber] }),
      ])
      const order = await orderByNumber(placed.orderNumber)
      const parcels = await db().execute<{ n: number }>(sql`
        select count(*)::int as n from shipments where order_id = ${order.id} and status <> 'cancelled'`)
      if (outcomes[0] === "ok") {
        expect(order.status).toBe("cancelled")
        expect(parcels.rows[0]!.n).toBe(0)
        expect((await stockOf(variantId)).on_hand).toBe(before.on_hand + 1)
      } else {
        expect(outcomes[0]).toBe("INVALID_STATE")
        expect(parcels.rows[0]!.n).toBe(1)
        expect(order.status).not.toBe("cancelled")
      }
    },
  )
})

describe("P5: two staff refund the same order", () => {
  it.each(runs)("P5: refunds never exceed what was paid (run %i)", async () => {
    const { customer, placed } = await unpaidOrder()
    const paid = await capture(customer, placed)
    await callback(customer, paid)
    const refund = (destination: "source" | "wallet") => () =>
      refundOrder(destination === "source" ? admin : support, {
        orderNumber: placed.orderNumber,
        amountPaise: paid.amountPaise,
        destination,
        reason: "Damaged in transit",
        idempotencyKey: randomUUID(),
      })
    const outcomes = await race([
      refund("source"),
      refund("source"),
      refund("wallet"),
    ])
    expect(count(outcomes, "ok")).toBe(1)
    const order = await orderByNumber(placed.orderNumber)
    const money = await db().execute<{
      to_source: number
      to_wallet: number
    }>(sql`
        select
          coalesce((select sum(amount_paise) from refunds where order_id = ${order.id} and status <> 'failed'), 0)::int as to_source,
          coalesce((select sum(amount_paise) from wallet_ledger where reference_type = 'order' and reference_id = ${order.id} and reason = 'order_refund'), 0)::int as to_wallet`)
    const { to_source, to_wallet } = money.rows[0]!
    expect(to_source + to_wallet).toBe(paid.amountPaise)
  })
})

describe("P6–P7: background jobs racing a payment", () => {
  it.each(runs)(
    "P6: the reconciliation job and the webhook settle a payment once (run %i)",
    async () => {
      const { customer, placed } = await unpaidOrder()
      const paid = await capture(customer, placed)
      // Reconciliation only looks at payments older than two minutes.
      await db().execute(sql`
        update payments set created_at = now() - interval '5 minutes' where provider_order_id = ${paid.providerOrderId}`)
      const hook = webhookFor(paid)
      const outcomes = await race([
        () => reconcilePendingPayments(),
        async () => {
          await recordWebhook(hook)
          await processWebhookEvent(await webhookId(hook.eventId))
        },
      ])
      expect(outcomes).toEqual(["ok", "ok"])
      await expectConfirmedOnce(placed.orderNumber)
    },
  )

  it.each(runs)(
    "P7: the expiry job and the payment at the same instant: confirmed, never kept without an order (run %i)",
    async () => {
      const { customer, placed } = await unpaidOrder()
      await db().execute(sql`
        update orders set reservation_expires_at = now() - interval '5 minutes' where order_number = ${placed.orderNumber}`)
      // The customer completes payment just as the job runs.
      const paid = await capture(customer, placed)
      const outcomes = await race([
        () => expirePendingOrders(),
        () => callback(customer, paid),
      ])
      expect(outcomes).toEqual(["ok", "ok"])
      // Stock was plentiful, so either path ends confirmed.
      await expectConfirmedOnce(placed.orderNumber)
    },
  )
})

describe("all money accounted for", () => {
  it("leaves every invariant intact", async () => {
    await expectInvariants()
    // The fake gateway refunds; processing them must not double-pay either.
    const pending = await db().execute<{ id: string }>(
      sql`select id from refunds where status = 'pending'`,
    )
    const { processRefund } = await import("@/features/payments")
    await Promise.all(
      pending.rows.flatMap((r) => [processRefund(r.id), processRefund(r.id)]),
    )
    await expectInvariants()
  })
})

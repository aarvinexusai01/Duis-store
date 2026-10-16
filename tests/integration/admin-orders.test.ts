import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import {
  adminGetOrder,
  adminListOrders,
  cancelOrder,
  createShipments,
  getShipmentLabel,
  importCodRemittances,
  refundOrder,
  retryShipment,
  simulateTracking,
  staffCancelOrder,
  updateShippingAddress,
} from "@/features/orders"
import {
  failFakeShippingStep,
  ingestTrackingEvent,
  processTrackingWebhook,
  recordTrackingWebhook,
} from "@/features/shipping"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { createUserActor } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import {
  buyer,
  code,
  paidOrder,
  sellableProduct,
  type Buyer,
} from "../helpers/shop"

closeConnectionsAfterAll()

const db = () => getDb()
let variantId: string
let admin: Actor
let packer: Actor
let support: Actor

async function order(orderNumber: string) {
  const { rows } = await db().execute<{
    id: string
    status: string
    payment_status: string
    fulfillment_status: string
    cod_due_paise: number
    shipping_address: { stateCode: string; line1: string }
  }>(sql`select * from orders where order_number = ${orderNumber}`)
  return rows[0]!
}

async function parcel(orderNumber: string) {
  const { rows } = await db().execute<{
    id: string
    status: string
    awb: string | null
    provider_order_id: string | null
    label_file_key: string | null
    last_error: string | null
    cod_amount_paise: number
  }>(sql`
    select s.* from shipments s join orders o on o.id = s.order_id
    where o.order_number = ${orderNumber} order by s.created_at desc limit 1`)
  return rows[0]!
}

async function onHand() {
  const { rows } = await db().execute<{ on_hand: number }>(
    sql`select on_hand from inventory_levels where variant_id = ${variantId}`,
  )
  return rows[0]!.on_hand
}

async function ship(orderNumber: string) {
  const { results } = await createShipments(admin, {
    orderNumbers: [orderNumber],
  })
  return results[0]!
}

async function deliver(orderNumber: string) {
  const { id } = await parcel(orderNumber)
  for (let i = 0; i < 4; i += 1) {
    await simulateTracking(packer, { shipmentId: id, outcome: "next" })
  }
}

beforeAll(async () => {
  ;({ variantId } = await sellableProduct())
  admin = await createUserActor("store_admin")
  packer = await createUserActor("fulfilment_staff")
  support = await createUserActor("support_agent")
})

afterEach(() => failFakeShippingStep(null))

describe("parcels", () => {
  it("books a parcel (AWB, label, pickup) and follows it to delivery", async () => {
    const number = await paidOrder(await buyer(), variantId)
    expect(await ship(number)).toMatchObject({ ok: true, status: "ready" })
    const booked = await parcel(number)
    expect(booked).toMatchObject({ status: "ready_to_ship" })
    expect(booked.awb).toMatch(/^FK\d{10}$/)
    expect(await order(number)).toMatchObject({ status: "processing" })

    const label = await getShipmentLabel(packer, { shipmentId: booked.id })
    expect(label.data.subarray(0, 5).toString()).toBe("%PDF-")

    await deliver(number)
    expect(await parcel(number)).toMatchObject({ status: "delivered" })
    expect(await order(number)).toMatchObject({
      status: "delivered",
      fulfillment_status: "fulfilled",
    })
    const o = await order(number)
    const shipped = await db().execute(sql`
      select 1 from notification_logs where reference_id = ${o.id} and template = 'order-shipped'`)
    expect(shipped.rows).toHaveLength(1)
    // One live parcel per order.
    expect(await ship(number)).toMatchObject({ ok: false })
  })

  it("resumes a failed booking from the step that failed", async () => {
    const number = await paidOrder(await buyer(), variantId)
    failFakeShippingStep("label")
    const first = await ship(number)
    expect(first).toMatchObject({ ok: false })
    const half = await parcel(number)
    expect(half).toMatchObject({ status: "pending", label_file_key: null })
    expect(half.awb).not.toBeNull()
    expect(half.last_error).toContain("label")

    failFakeShippingStep(null)
    await retryShipment(packer, { shipmentId: half.id })
    const done = await parcel(number)
    expect(done.status).toBe("ready_to_ship")
    // The courier order and AWB from the first attempt are kept, not rebooked.
    expect(done.awb).toBe(half.awb)
    expect(done.provider_order_id).toBe(half.provider_order_id)
  })

  it("ignores duplicate and out-of-order courier events", async () => {
    const number = await paidOrder(await buyer(), variantId)
    await ship(number)
    const { awb } = await parcel(number)
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000)
    const event = (status: string, minutes: number) => ({
      providerStatus: status,
      occurredAt: at(minutes),
      location: null,
      description: null,
    })
    const outForDelivery = event("OUT FOR DELIVERY", 10)
    expect(await ingestTrackingEvent({ awb: awb! }, outForDelivery)).toBe(
      "applied",
    )
    expect(await ingestTrackingEvent({ awb: awb! }, outForDelivery)).toBe(
      "duplicate",
    )
    expect(
      await ingestTrackingEvent({ awb: awb! }, event("IN TRANSIT", 5)),
    ).toBe("recorded")
    expect(await parcel(number)).toMatchObject({ status: "out_for_delivery" })
    expect(await order(number)).toMatchObject({ status: "out_for_delivery" })

    // The webhook path: stored once, processed by the job.
    const payload = {
      awb,
      current_status: "Delivered",
      current_timestamp: at(20)
        .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
        .slice(0, 19),
    }
    expect(await recordTrackingWebhook(payload)).toBe(true)
    expect(await recordTrackingWebhook(payload)).toBe(false)
    const stored = await db().execute<{ id: string }>(sql`
      select id from webhook_events where provider = 'shiprocket' and payload->>'awb' = ${awb} order by received_at desc limit 1`)
    expect(await processTrackingWebhook(stored.rows[0]!.id)).toBe("applied")
    expect(await order(number)).toMatchObject({ status: "delivered" })
  })

  it("restocks a parcel that comes back (RTO)", async () => {
    const number = await paidOrder(await buyer(), variantId)
    await ship(number)
    const stockBefore = await onHand()
    const { id } = await parcel(number)
    await simulateTracking(packer, { shipmentId: id, outcome: "next" })
    await simulateTracking(packer, { shipmentId: id, outcome: "rto" })
    await simulateTracking(packer, { shipmentId: id, outcome: "next" })
    expect(await order(number)).toMatchObject({
      status: "rto_delivered",
      fulfillment_status: "returned",
    })
    expect(await onHand()).toBe(stockBefore + 1)
  })
})

describe("cancellation", () => {
  it("stops customer cancellation once a parcel is booked; staff cancel with the courier first", async () => {
    const customer = await buyer()
    const number = await paidOrder(customer, variantId)
    await ship(number)
    expect(await code(cancelOrder(customer, { orderNumber: number }))).toBe(
      "INVALID_STATE",
    )
    const stockBefore = await onHand()
    await staffCancelOrder(support, {
      orderNumber: number,
      reason: "customer called to cancel",
    })
    expect(await parcel(number)).toMatchObject({ status: "cancelled" })
    expect(await order(number)).toMatchObject({ status: "cancelled" })
    expect(await onHand()).toBe(stockBefore + 1)
    const refunds = await db().execute(sql`
      select 1 from refunds r join orders o on o.id = r.order_id where o.order_number = ${number}`)
    expect(refunds.rows).toHaveLength(1)
  })

  it("refuses once the courier has the parcel, and when the courier refuses", async () => {
    const number = await paidOrder(await buyer(), variantId)
    await ship(number)
    failFakeShippingStep("cancel")
    expect(
      await code(
        staffCancelOrder(support, { orderNumber: number, reason: "test" }),
      ),
    ).toBe("CONFLICT")
    expect(await order(number)).toMatchObject({ status: "processing" })
    failFakeShippingStep(null)

    const { id } = await parcel(number)
    await simulateTracking(packer, { shipmentId: id, outcome: "next" })
    expect(
      await code(
        staffCancelOrder(support, { orderNumber: number, reason: "test" }),
      ),
    ).toBe("INVALID_STATE")
  })
})

describe("refunds", () => {
  it("refunds part to the payment and part to the wallet, never more than was paid", async () => {
    const customer = await buyer()
    const number = await paidOrder(customer, variantId)
    const detail = await adminGetOrder(admin, { orderNumber: number })
    const total = detail.money!.totalPaise
    expect(detail.money!.refundable).toEqual({
      toSourcePaise: total,
      toWalletPaise: total,
    })

    await refundOrder(admin, {
      orderNumber: number,
      amountPaise: 20_000,
      destination: "source",
      reason: "late dispatch",
      idempotencyKey: randomUUID(),
    })
    const key = randomUUID()
    const toWallet = {
      orderNumber: number,
      amountPaise: 10_000,
      destination: "wallet" as const,
      reason: "goodwill on delay",
      idempotencyKey: key,
    }
    await refundOrder(admin, toWallet)
    // The same request again does nothing.
    await refundOrder(admin, toWallet)
    const after = await adminGetOrder(admin, { orderNumber: number })
    expect(after.money!.refundable.toWalletPaise).toBe(total - 30_000)
    expect(after.paymentStatus).toBe("partially_refunded")
    const wallet = await db().execute<{ balance: number }>(
      sql`select balance_paise as balance from wallet_accounts where user_id = ${customer.userId}`,
    )
    expect(wallet.rows[0]!.balance).toBe(10_000)

    expect(
      await code(
        refundOrder(admin, {
          ...toWallet,
          amountPaise: total,
          idempotencyKey: randomUUID(),
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    // Support agents can't refund.
    expect(
      await code(
        refundOrder(support, { ...toWallet, idempotencyKey: randomUUID() }),
      ),
    ).toBe("FORBIDDEN")
  })
})

describe("COD remittance", () => {
  let customer: Buyer
  let number: string

  beforeAll(async () => {
    customer = await buyer()
    number = await paidOrder(customer, variantId, {
      paymentMode: "partial_cod",
    })
  })

  it("collects only the COD balance and matches the remittance by AWB", async () => {
    const o = await order(number)
    expect(o.payment_status).toBe("partially_paid")
    await ship(number)
    const p = await parcel(number)
    expect(p.cod_amount_paise).toBe(o.cod_due_paise)

    const due = (o.cod_due_paise / 100).toFixed(2)
    const early = await importCodRemittances(admin, {
      csv: `AWB,Amount,UTR,Date\n${p.awb},${due},UTR1,2026-10-16`,
    })
    expect(early.problems[0]!.reason).toContain("isn't delivered")

    await deliver(number)
    const result = await importCodRemittances(admin, {
      csv: [
        "AWB No.,COD Amount,UTR,Remitted On",
        `${p.awb},1.00,UTR1,16/10/2026`,
        `${p.awb},"₹${due}",UTR1,16/10/2026`,
        `${p.awb},${due},UTR1,16/10/2026`,
        "UNKNOWN,10,UTR2,2026-10-16",
      ].join("\n"),
    })
    expect(result).toMatchObject({ rows: 4, matched: 1, already: 1 })
    expect(result.problems.map((p) => p.line)).toEqual([2, 5])
    expect(await order(number)).toMatchObject({ payment_status: "paid" })
  })

  it("is for staff who see money", async () => {
    expect(await code(importCodRemittances(packer, { csv: "a\n1" }))).toBe(
      "FORBIDDEN",
    )
  })
})

describe("what each role sees and changes", () => {
  it("hides money from packing staff", async () => {
    const number = await paidOrder(await buyer(), variantId)
    const detail = await adminGetOrder(packer, { orderNumber: number })
    expect(detail.money).toBeNull()
    expect(detail.items[0]!.money).toBeNull()
    const list = await adminListOrders(packer, { q: number })
    expect(list.rows[0]).toMatchObject({
      orderNumber: number,
      totalPaise: null,
    })
    const full = await adminListOrders(admin, { q: number })
    expect(full.rows[0]!.totalPaise).toBeGreaterThan(0)
  })

  it("corrects an address within the same state, before booking only", async () => {
    const number = await paidOrder(await buyer(), variantId)
    const address = {
      fullName: "Test Buyer",
      phone: "9876543210",
      line1: "22 Gomti Nagar",
      city: "Lucknow",
      stateCode: "IN-UP",
      postalCode: "226010",
      countryCode: "IN",
    }
    await updateShippingAddress(support, { orderNumber: number, address })
    expect((await order(number)).shipping_address.line1).toBe("22 Gomti Nagar")
    expect(
      await code(
        updateShippingAddress(support, {
          orderNumber: number,
          address: { ...address, stateCode: "IN-MH", postalCode: "400001" },
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    await ship(number)
    expect(
      await code(
        updateShippingAddress(support, { orderNumber: number, address }),
      ),
    ).toBe("INVALID_STATE")
  })

  it("audits staff changes", async () => {
    const number = await paidOrder(await buyer(), variantId)
    await ship(number)
    const o = await order(number)
    const audit = await db().execute<{ action: string }>(sql`
      select action from audit_logs where entity_id = ${o.id} order by created_at`)
    expect(audit.rows.map((r) => r.action)).toContain("shipment.create")
  })
})

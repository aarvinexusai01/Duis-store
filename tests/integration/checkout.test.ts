import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { addCartItem } from "@/features/cart"
import { publishProduct, setProductMedia } from "@/features/catalog"
import {
  getCheckoutQuote,
  placeOrder,
  simulatePayment,
  startPayment,
  verifyPayment,
  type PlaceResult,
} from "@/features/checkout"
import { saveAddress } from "@/features/customers"
import { createDiscount } from "@/features/discounts"
import { adjustStock } from "@/features/inventory"
import { uploadImage } from "@/features/media"
import {
  cancelOrder,
  expirePendingOrders,
  processWebhookEvent,
  recordWebhook,
} from "@/features/orders"
import {
  hmacHex,
  FAKE_GATEWAY_SECRET,
  processRefund,
} from "@/features/payments"
import {
  creditWallet,
  expireWalletCredits,
  spendableBalance,
} from "@/features/wallet"
import type { UserActor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { isDomainError } from "@/server/errors"

import { asSystem, createUserActor, unique } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"

closeConnectionsAfterAll()

const db = () => getDb()
let fx: Awaited<ReturnType<typeof createProductFixture>>
let blackM: string
let blackL: string

async function variant(signature: string) {
  const { rows } = await db().execute<{ id: string }>(sql`
    select id from product_variants where product_id = ${fx.productId} and option_signature = ${signature}`)
  return rows[0]!.id
}

async function stock(variantId: string) {
  const { rows } = await db().execute<{
    on_hand: number
    reserved: number
  }>(sql`
    select on_hand, reserved from inventory_levels where variant_id = ${variantId}`)
  return rows[0]!
}

async function customer(
  options: { phoneVerified?: boolean } = {},
): Promise<UserActor & { addressId: string }> {
  const actor = (await createUserActor("customer")) as UserActor
  if (options.phoneVerified) {
    await db().execute(sql`
      update users set phone_number = ${`+9198${String(Date.now()).slice(-8)}`}, phone_number_verified = true
      where id = ${actor.userId}`)
  }
  const { id } = await saveAddress(actor, {
    fullName: "Test Buyer",
    phone: "9876543210",
    line1: "1 Hazratganj",
    city: "Lucknow",
    stateCode: "IN-UP",
    postalCode: "226001",
    countryCode: "IN",
  })
  return { ...actor, addressId: id }
}

async function code(work: Promise<unknown>) {
  try {
    await work
    return "ok"
  } catch (error) {
    return isDomainError(error) ? error.code : String(error)
  }
}

type Buyer = Awaited<ReturnType<typeof customer>>

async function place(
  buyer: Buyer,
  options: {
    paymentMode?: "prepaid" | "partial_cod"
    useWallet?: boolean
    couponCode?: string
  } = {},
) {
  const choices = {
    addressId: buyer.addressId,
    paymentMode: options.paymentMode ?? "prepaid",
    useWallet: options.useWallet ?? false,
    couponCode: options.couponCode,
  } as const
  const view = await getCheckoutQuote(buyer, choices)
  const result = await placeOrder(buyer, {
    ...choices,
    quoteHash: view.hash,
    idempotencyKey: randomUUID(),
  })
  return { view, result }
}

async function pay(
  buyer: Buyer,
  result: PlaceResult,
  outcome: "captured" | "failed" = "captured",
) {
  if (result.status !== "pay") throw new Error("nothing to pay")
  const { paymentId, signature } = await simulatePayment(buyer, {
    orderNumber: result.orderNumber,
    providerOrderId: result.payment.providerOrderId,
    outcome,
  })
  return verifyPayment(buyer, {
    orderNumber: result.orderNumber,
    providerOrderId: result.payment.providerOrderId,
    providerPaymentId: paymentId,
    signature,
  })
}

async function orderRow(orderNumber: string) {
  const { rows } = await db().execute<{
    id: string
    status: string
    payment_status: string
    total_paise: number
    online_amount_paise: number
    cod_due_paise: number
    wallet_applied_paise: number
  }>(sql`select * from orders where order_number = ${orderNumber}`)
  return rows[0]!
}

beforeAll(async () => {
  fx = await createProductFixture()
  const image = await uploadImage(asSystem(), {
    bytes: await makeUniqueImage(),
  })
  await setProductMedia(asSystem(), {
    productId: fx.productId,
    items: [{ mediaId: image.id, colorValueId: fx.black }],
  })
  await publishProduct(asSystem(), { id: fx.productId })
  blackM = await variant("color=black;size=m")
  blackL = await variant("color=black;size=l")
  await adjustStock(asSystem(), {
    variantId: blackM,
    delta: 50,
    reason: "receive",
  })
})

describe("prepaid checkout", () => {
  it("quotes, places, pays and confirms: stock committed, bag emptied", async () => {
    const buyer = await customer()
    await addCartItem(buyer, { variantId: blackM, quantity: 2 })
    const before = await stock(blackM)
    const { view, result } = await place(buyer)
    // ₹799 × 2 = ₹1,598: free shipping; Lucknow is in Uttar Pradesh → CGST + SGST.
    expect(view.quote).toMatchObject({
      totalPaise: 159_800,
      shippingFeePaise: 0,
      intraState: true,
    })
    expect(result.status).toBe("pay")
    expect((await stock(blackM)).reserved).toBe(before.reserved + 2)

    expect(await pay(buyer, result)).toEqual({ status: "confirmed" })
    const order = await orderRow(result.orderNumber)
    expect(order).toMatchObject({ status: "confirmed", payment_status: "paid" })
    const after = await stock(blackM)
    expect(after).toEqual({
      on_hand: before.on_hand - 2,
      reserved: before.reserved,
    })
    const bag = await db().execute(sql`
      select 1 from cart_items ci join carts c on c.id = ci.cart_id where c.user_id = ${buyer.userId}`)
    expect(bag.rows).toHaveLength(0)
    const emails = await db().execute(sql`
      select 1 from notification_logs where reference_id = ${order.id} and template = 'order-confirmed'`)
    expect(emails.rows).toHaveLength(1)
  })

  it("ignores tampered totals: a stale quote hash is refused, and repeats return the same order", async () => {
    const buyer = await customer()
    await addCartItem(buyer, { variantId: blackM, quantity: 1 })
    const choices = {
      addressId: buyer.addressId,
      paymentMode: "prepaid" as const,
      useWallet: false,
    }
    expect(
      await code(
        placeOrder(buyer, {
          ...choices,
          quoteHash: "0".repeat(32),
          idempotencyKey: randomUUID(),
        }),
      ),
    ).toBe("CONFLICT")
    const view = await getCheckoutQuote(buyer, choices)
    const key = randomUUID()
    const first = await placeOrder(buyer, {
      ...choices,
      quoteHash: view.hash,
      idempotencyKey: key,
    })
    const again = await placeOrder(buyer, {
      ...choices,
      quoteHash: view.hash,
      idempotencyKey: key,
    })
    expect(again.orderNumber).toBe(first.orderNumber)
    // Below ₹999 the live courier rate is charged.
    expect(view.quote.shippingFeePaise).toBeGreaterThan(0)
  })

  it("survives a failed payment and confirms on retry", async () => {
    const buyer = await customer()
    await addCartItem(buyer, { variantId: blackM, quantity: 1 })
    const { result } = await place(buyer)
    expect(await pay(buyer, result, "failed")).toEqual({ status: "failed" })
    expect((await orderRow(result.orderNumber)).status).toBe("pending_payment")
    const retry = await startPayment(buyer, { orderNumber: result.orderNumber })
    expect(retry.providerOrderId).toBe(
      result.status === "pay" ? result.payment.providerOrderId : "",
    )
    expect(
      await pay(buyer, { ...result, status: "pay", payment: retry }),
    ).toEqual({ status: "confirmed" })
  })
})

describe("concurrency", () => {
  it("sells the last unit exactly once", async () => {
    await adjustStock(asSystem(), {
      variantId: blackL,
      delta: 1,
      reason: "receive",
    })
    const buyers = await Promise.all([
      customer(),
      customer(),
      customer(),
      customer(),
    ])
    for (const b of buyers)
      await addCartItem(b, { variantId: blackL, quantity: 1 })
    const views = await Promise.all(
      buyers.map((b) =>
        getCheckoutQuote(b, {
          addressId: b.addressId,
          paymentMode: "prepaid",
          useWallet: false,
        }),
      ),
    )
    const outcomes = await Promise.all(
      buyers.map((b, i) =>
        code(
          placeOrder(b, {
            addressId: b.addressId,
            paymentMode: "prepaid",
            useWallet: false,
            quoteHash: views[i]!.hash,
            idempotencyKey: randomUUID(),
          }),
        ),
      ),
    )
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1)
    expect(outcomes.filter((o) => o === "OUT_OF_STOCK")).toHaveLength(3)
    expect(await stock(blackL)).toMatchObject({ reserved: 1 })
  })

  it("holds a coupon's usage limit under concurrent orders", async () => {
    const couponCode = unique("ONCE").toUpperCase().replace(/-/g, "")
    await createDiscount(asSystem(), {
      name: "One use",
      kind: "coupon",
      code: couponCode,
      valueType: "fixed",
      value: 10_000,
      usageLimitTotal: 1,
    })
    const buyers = await Promise.all([customer(), customer(), customer()])
    for (const b of buyers)
      await addCartItem(b, { variantId: blackM, quantity: 2 })
    const outcomes = await Promise.all(
      buyers.map((b) => code(place(b, { couponCode }))),
    )
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1)
    const used = await db().execute<{ times_used: number }>(
      sql`select times_used from coupons where code = ${couponCode}`,
    )
    expect(used.rows[0]!.times_used).toBe(1)
  })
})

describe("webhooks", () => {
  it("treats duplicate and out-of-order events as no-ops", async () => {
    const buyer = await customer()
    await addCartItem(buyer, { variantId: blackM, quantity: 1 })
    const { result } = await place(buyer)
    if (result.status !== "pay") throw new Error("expected payment")
    const providerOrderId = result.payment.providerOrderId
    const { paymentId } = await simulatePayment(buyer, {
      orderNumber: result.orderNumber,
      providerOrderId,
      outcome: "captured",
    })
    const entity = (status: string) => ({
      id: paymentId,
      order_id: providerOrderId,
      status,
      amount: result.payment.amountPaise,
      currency: "INR",
      method: "upi",
    })
    const events = [
      {
        id: `evt_${randomUUID()}`,
        event: "payment.captured",
        status: "captured",
      },
      { id: `evt_${randomUUID()}`, event: "payment.failed", status: "failed" },
    ]
    for (const e of events) {
      const payload = {
        event: e.event,
        payload: { payment: { entity: entity(e.status) } },
      }
      expect(
        await recordWebhook({
          provider: "fake",
          eventId: e.id,
          eventType: e.event,
          payload,
        }),
      ).toBe(true)
      expect(
        await recordWebhook({
          provider: "fake",
          eventId: e.id,
          eventType: e.event,
          payload,
        }),
      ).toBe(false)
    }
    const stored = await db().execute<{ id: string }>(sql`
      select id from webhook_events where event_id in (${events[0]!.id}, ${events[1]!.id}) order by received_at`)
    for (const row of stored.rows) {
      await processWebhookEvent(row.id)
      await processWebhookEvent(row.id)
    }
    expect(await orderRow(result.orderNumber)).toMatchObject({
      status: "confirmed",
      payment_status: "paid",
    })
    const payments = await db().execute<{ status: string }>(
      sql`select status from payments where provider_order_id = ${providerOrderId}`,
    )
    expect(payments.rows).toEqual([{ status: "captured" }])
  })

  it("only accepts correctly signed payloads", () => {
    const body = JSON.stringify({ event: "payment.captured" })
    const good = hmacHex(FAKE_GATEWAY_SECRET, body)
    expect(good).toMatch(/^[0-9a-f]{64}$/)
    expect(hmacHex(FAKE_GATEWAY_SECRET, `${body} `)).not.toBe(good)
  })
})

describe("expiry", () => {
  it("releases stock, wallet and coupon when payment never arrives", async () => {
    const buyer = await customer()
    await withTransaction((tx) =>
      creditWallet(tx, {
        userId: buyer.userId,
        amountPaise: 20_000,
        reason: "goodwill",
        idempotencyKey: `gw:${randomUUID()}`,
      }),
    )
    const couponCode = unique("SAVE").toUpperCase().replace(/-/g, "")
    await createDiscount(asSystem(), {
      name: "Save",
      kind: "coupon",
      code: couponCode,
      valueType: "percentage",
      value: 1_000,
    })
    await addCartItem(buyer, { variantId: blackM, quantity: 2 })
    const before = await stock(blackM)
    const { result } = await place(buyer, { useWallet: true, couponCode })
    const placed = await orderRow(result.orderNumber)
    expect(placed.wallet_applied_paise).toBe(20_000)
    expect(await spendableBalance(db(), buyer.userId)).toBe(0)

    await db().execute(
      sql`update orders set reservation_expires_at = now() - interval '5 minutes' where id = ${placed.id}`,
    )
    const outcome = await expirePendingOrders()
    expect(outcome.expired).toBeGreaterThanOrEqual(1)
    expect((await orderRow(result.orderNumber)).status).toBe("expired")
    expect(await stock(blackM)).toEqual(before)
    expect(await spendableBalance(db(), buyer.userId)).toBe(20_000)
    const coupon = await db().execute<{ times_used: number }>(
      sql`select times_used from coupons where code = ${couponCode}`,
    )
    expect(coupon.rows[0]!.times_used).toBe(0)
  })

  it("confirms a payment that arrives after expiry while stock remains", async () => {
    const buyer = await customer()
    await addCartItem(buyer, { variantId: blackM, quantity: 1 })
    const { result } = await place(buyer)
    if (result.status !== "pay") throw new Error("expected payment")
    const placed = await orderRow(result.orderNumber)
    // The customer started paying but the gateway hadn't reported it yet.
    const { paymentId, signature } = await simulatePayment(buyer, {
      orderNumber: result.orderNumber,
      providerOrderId: result.payment.providerOrderId,
      outcome: "captured",
    })
    await db().execute(
      sql`update orders set reservation_expires_at = now() - interval '5 minutes' where id = ${placed.id}`,
    )
    // The expiry job asks the gateway first, so it confirms instead.
    const outcome = await expirePendingOrders()
    expect(outcome.confirmed).toBeGreaterThanOrEqual(1)
    expect((await orderRow(result.orderNumber)).status).toBe("confirmed")
    // The late browser callback is then a no-op.
    expect(
      await verifyPayment(buyer, {
        orderNumber: result.orderNumber,
        providerOrderId: result.payment.providerOrderId,
        providerPaymentId: paymentId,
        signature,
      }),
    ).toEqual({ status: "confirmed" })
  })
})

describe("partial COD", () => {
  it("records the online advance and the cash due", async () => {
    const buyer = await customer({ phoneVerified: true })
    await addCartItem(buyer, { variantId: blackM, quantity: 1 })
    const { view, result } = await place(buyer, { paymentMode: "partial_cod" })
    expect(view.codAvailable).toBe(true)
    const order = await orderRow(result.orderNumber)
    expect(order.online_amount_paise).toBe(10_000)
    expect(order.cod_due_paise).toBe(order.total_paise - 10_000)
    expect(await pay(buyer, result)).toEqual({ status: "confirmed" })
    expect((await orderRow(result.orderNumber)).payment_status).toBe(
      "partially_paid",
    )
  })

  it("is refused without a verified phone", async () => {
    const buyer = await customer()
    await addCartItem(buyer, { variantId: blackM, quantity: 1 })
    const view = await getCheckoutQuote(buyer, {
      addressId: buyer.addressId,
      paymentMode: "partial_cod",
      useWallet: false,
    })
    expect(view.codAvailable).toBe(false)
    expect(view.quote.issues).toContainEqual(
      expect.objectContaining({ code: "COD_UNAVAILABLE", blocking: true }),
    )
  })
})

describe("cancellation", () => {
  it("restocks, refunds online money to source and wallet money to the wallet", async () => {
    const buyer = await customer()
    await withTransaction((tx) =>
      creditWallet(tx, {
        userId: buyer.userId,
        amountPaise: 5_000,
        reason: "goodwill",
        idempotencyKey: `gw:${randomUUID()}`,
      }),
    )
    await addCartItem(buyer, { variantId: blackM, quantity: 2 })
    const before = await stock(blackM)
    const { result } = await place(buyer, { useWallet: true })
    await pay(buyer, result)
    const order = await orderRow(result.orderNumber)

    const cancelled = await cancelOrder(buyer, {
      orderNumber: result.orderNumber,
    })
    expect(cancelled).toEqual({
      refundPaise: order.online_amount_paise,
      walletPaise: 5_000,
    })
    expect(await stock(blackM)).toEqual(before)
    expect(await spendableBalance(db(), buyer.userId)).toBe(5_000)
    // Cancelling twice is refused, and never refunds twice.
    expect(
      await code(cancelOrder(buyer, { orderNumber: result.orderNumber })),
    ).toBe("INVALID_STATE")

    const refund = await db().execute<{ id: string }>(
      sql`select id from refunds where order_id = ${order.id}`,
    )
    expect(refund.rows).toHaveLength(1)
    expect(await processRefund(refund.rows[0]!.id)).toBe("processed")
    expect(await processRefund(refund.rows[0]!.id)).toBe("skipped")
    expect(await orderRow(result.orderNumber)).toMatchObject({
      status: "cancelled",
      payment_status: "refunded",
    })
  })
})

describe("wallet expiry", () => {
  it("expires promotional credit but never refunds", async () => {
    const buyer = await customer()
    await withTransaction(async (tx) => {
      await creditWallet(tx, {
        userId: buyer.userId,
        amountPaise: 3_000,
        reason: "goodwill",
        idempotencyKey: `gw:${randomUUID()}`,
        expiresAt: new Date(Date.now() - 1_000),
      })
      await creditWallet(tx, {
        userId: buyer.userId,
        amountPaise: 7_000,
        reason: "cancellation_refund",
        idempotencyKey: `rf:${randomUUID()}`,
      })
    })
    expect(await spendableBalance(db(), buyer.userId)).toBe(7_000)
    await expireWalletCredits()
    const account = await db().execute<{ balance_paise: number }>(sql`
      select balance_paise from wallet_accounts where user_id = ${buyer.userId}`)
    expect(account.rows[0]!.balance_paise).toBe(7_000)
  })
})

describe("international checkout", () => {
  async function abroad(countryCode: string) {
    const buyer = await customer()
    const { id } = await saveAddress(buyer, {
      fullName: "Sam Smith",
      phone: "+44 7700 900123",
      line1: "1 High Street",
      city: "London",
      region: "Greater London",
      postalCode: "SW1A 1AA",
      countryCode,
    })
    await addCartItem(buyer, { variantId: blackM, quantity: 2 })
    return { ...buyer, addressId: id }
  }

  it("is prepaid only, zero-rated for GST, and always charges the live rate", async () => {
    const buyer = await abroad("GB")
    const view = await getCheckoutQuote(buyer, {
      addressId: buyer.addressId,
      paymentMode: "prepaid",
      useWallet: false,
    })
    expect(view.quote).toMatchObject({ isExport: true, taxTotalPaise: 0 })
    // ₹1,598 is above the Indian free-shipping threshold, but abroad the rate always applies.
    expect(view.quote.shippingFeePaise).toBeGreaterThan(0)
    expect(view.codAvailable).toBe(false)
    const { result } = await place(buyer)
    expect(await pay(buyer, result)).toEqual({ status: "confirmed" })
    const order = await db().execute<{
      is_export: boolean
      destination_country: string
    }>(sql`
      select is_export, destination_country from orders where order_number = ${result.orderNumber}`)
    expect(order.rows[0]).toEqual({
      is_export: true,
      destination_country: "GB",
    })
  })

  it("refuses destinations outside the approved list", async () => {
    const buyer = await abroad("BR")
    const view = await getCheckoutQuote(buyer, {
      addressId: buyer.addressId,
      paymentMode: "prepaid",
      useWallet: false,
    })
    expect(view.quote.issues).toContainEqual(
      expect.objectContaining({ code: "DELIVERY_UNAVAILABLE", blocking: true }),
    )
  })
})

describe("late payment", () => {
  it("refunds in full when the stock sold out after expiry", async () => {
    const whiteS = await variant("color=white;size=s")
    await adjustStock(asSystem(), {
      variantId: whiteS,
      delta: 1,
      reason: "receive",
    })
    const buyer = await customer()
    await addCartItem(buyer, { variantId: whiteS, quantity: 1 })
    const { result } = await place(buyer)
    if (result.status !== "pay") throw new Error("expected payment")
    const placed = await orderRow(result.orderNumber)
    // The reservation runs out with no payment reported, so the order expires…
    await db().execute(
      sql`update orders set reservation_expires_at = now() - interval '5 minutes' where id = ${placed.id}`,
    )
    await expirePendingOrders()
    expect((await orderRow(result.orderNumber)).status).toBe("expired")
    // …someone else buys the last unit…
    const rival = await customer()
    await addCartItem(rival, { variantId: whiteS, quantity: 1 })
    await pay(rival, (await place(rival)).result)
    // …and only then does the first customer's payment arrive.
    expect(await pay(buyer, result)).toEqual({ status: "cancelled" })
    expect((await orderRow(result.orderNumber)).status).toBe("cancelled")
    const refund = await db().execute<{
      amount_paise: number
      reason: string
    }>(sql`
      select amount_paise, reason from refunds where order_id = ${placed.id}`)
    expect(refund.rows).toEqual([
      {
        amount_paise: placed.online_amount_paise,
        reason: "stock_unavailable_after_payment",
      },
    ])
  })
})

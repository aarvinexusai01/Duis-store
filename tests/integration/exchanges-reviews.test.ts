import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { simulatePayment, verifyPayment } from "@/features/checkout"
import {
  approveExchange,
  cancelMyExchange,
  failExchangeQc,
  getExchangeOptions,
  passExchangeQc,
  rejectExchange,
  requestExchange,
  startExchangePayment,
} from "@/features/exchanges"
import { readCustomerPhoto, uploadCustomerPhoto } from "@/features/media"
import {
  createShipments,
  getTracking,
  simulateTracking,
  trackingToken,
} from "@/features/orders"
import {
  displayNameFor,
  loadProductReviews,
  moderateReview,
  submitReview,
} from "@/features/reviews"
import { advanceShipment } from "@/features/shipping"
import { anonymousActor, type Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { createUserActor } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"
import {
  buyer,
  code,
  paidOrder,
  sellableProduct,
  type Buyer,
} from "../helpers/shop"

closeConnectionsAfterAll()

const db = () => getDb()
let fx: Awaited<ReturnType<typeof sellableProduct>>
let admin: Actor
let support: Actor
let packer: Actor
const variants: Record<string, string> = {}

async function stock(variantId: string) {
  const { rows } = await db().execute<{ on_hand: number; reserved: number }>(
    sql`select on_hand, reserved from inventory_levels where variant_id = ${variantId}`,
  )
  return rows[0]!
}

async function exchange(number: string) {
  const { rows } = await db().execute<{ id: string; status: string }>(
    sql`select id, status from exchange_requests where exchange_number = ${number}`,
  )
  return rows[0]!
}

async function parcels(exchangeId: string) {
  const { rows } = await db().execute<{
    id: string
    direction: string
    status: string
  }>(sql`
    select id, direction, status from shipments where exchange_id = ${exchangeId} order by created_at`)
  return rows
}

/** Every scan up to delivery for one parcel (fake courier). */
async function deliverParcel(shipmentId: string) {
  for (let i = 0; i < 4; i += 1) {
    await simulateTracking(packer, { shipmentId, outcome: "next" })
  }
}

async function deliveredOrder(customer: Buyer, variantId = variants.black_m!) {
  const number = await paidOrder(customer, variantId)
  const { results } = await createShipments(admin, { orderNumbers: [number] })
  expect(results[0]).toMatchObject({ ok: true })
  const { rows } = await db().execute<{ id: string }>(sql`
    select s.id from shipments s join orders o on o.id = s.order_id where o.order_number = ${number}`)
  await deliverParcel(rows[0]!.id)
  return number
}

async function orderItemId(number: string) {
  const { rows } = await db().execute<{ id: string }>(sql`
    select oi.id from order_items oi join orders o on o.id = oi.order_id where o.order_number = ${number}`)
  return rows[0]!.id
}

beforeAll(async () => {
  fx = await sellableProduct(20)
  const { rows } = await db().execute<{
    id: string
    option_signature: string
  }>(sql`
    select id, option_signature from product_variants where product_id = ${fx.productId}`)
  for (const row of rows) {
    variants[
      row.option_signature.replace("color=", "").replace(";size=", "_")
    ] = row.id
  }
  // White L costs more, white S less (black M was bought at ₹799).
  await db().execute(
    sql`update product_variants set price_paise = 99_900, mrp_paise = 99_900 where id = ${variants.white_l!}`,
  )
  await db().execute(
    sql`update product_variants set price_paise = 59_900 where id = ${variants.white_s!}`,
  )
  admin = await createUserActor("store_admin")
  support = await createUserActor("support_agent")
  packer = await createUserActor("fulfilment_staff")
})

describe("exchange eligibility", () => {
  it("opens only after delivery, within the window", async () => {
    const customer = await buyer()
    const number = await paidOrder(customer, variants.black_m!)
    const before = await getExchangeOptions(customer, { orderNumber: number })
    expect(before.items[0]).toMatchObject({ eligible: false })
    expect(before.items[0]!.why).toMatch(/delivered/)

    const delivered = await deliveredOrder(await buyer())
    await db().execute(sql`
      update shipments set delivered_at = now() - interval '20 days'
      where order_id = (select id from orders where order_number = ${delivered})`)
    const { rows } = await db().execute<{ user_id: string }>(
      sql`select user_id from orders where order_number = ${delivered}`,
    )
    const owner = {
      kind: "user",
      userId: rows[0]!.user_id,
      roles: ["customer"],
      twoFactorEnabled: false,
      requestId: "t",
      ip: null,
    } as Actor
    const late = await getExchangeOptions(owner, { orderNumber: delivered })
    expect(late.items[0]!.why).toMatch(/window has closed/)
  })
})

describe("an exchange end to end", () => {
  it("same price: pickup, QC, replacement and stock all line up", async () => {
    const customer = await buyer()
    const number = await deliveredOrder(customer)
    const itemId = await orderItemId(number)
    const blackL = await stock(variants.black_l!)
    const blackM = await stock(variants.black_m!)

    const { exchangeNumber } = await requestExchange(customer, {
      orderNumber: number,
      orderItemId: itemId,
      variantId: variants.black_l!,
      quantity: 1,
      reason: "too_small",
    })
    // Only one open exchange per item.
    expect(
      await code(
        requestExchange(customer, {
          orderNumber: number,
          orderItemId: itemId,
          variantId: variants.black_l!,
          quantity: 1,
          reason: "too_small",
        }),
      ),
    ).toBe("INVALID_STATE")

    await approveExchange(support, { exchangeNumber })
    const ex = await exchange(exchangeNumber)
    expect(ex.status).toBe("pickup_scheduled")
    expect((await stock(variants.black_l!)).reserved).toBe(blackL.reserved + 1)

    const [pickup] = await parcels(ex.id)
    expect(pickup).toMatchObject({
      direction: "reverse",
      status: "ready_to_ship",
    })
    await deliverParcel(pickup!.id)
    expect((await exchange(exchangeNumber)).status).toBe("received")

    await passExchangeQc(packer, { exchangeNumber })
    // The returned item is back on the shelf.
    expect((await stock(variants.black_m!)).on_hand).toBe(blackM.on_hand + 1)
    const [, replacement] = await parcels(ex.id)
    expect(replacement).toMatchObject({ direction: "replacement" })
    expect((await exchange(exchangeNumber)).status).toBe("replacement_shipped")
    // The held replacement has left the shelf.
    expect(await stock(variants.black_l!)).toEqual({
      on_hand: blackL.on_hand - 1,
      reserved: blackL.reserved,
    })
    await deliverParcel(replacement!.id)
    expect((await exchange(exchangeNumber)).status).toBe("completed")

    const movements = await db().execute<{ reason: string }>(sql`
      select reason from inventory_movements where reference_type = 'exchange' and reference_id = ${ex.id}
      order by created_at`)
    expect(movements.rows.map((m) => m.reason)).toEqual([
      "exchange_in",
      "exchange_out",
    ])
    // The order itself stays delivered.
    const order = await db().execute<{ status: string }>(
      sql`select status from orders where order_number = ${number}`,
    )
    expect(order.rows[0]!.status).toBe("delivered")
  })

  it("cheaper option: the difference goes to the wallet after QC", async () => {
    const customer = await buyer()
    const number = await deliveredOrder(customer)
    const { exchangeNumber } = await requestExchange(customer, {
      orderNumber: number,
      orderItemId: await orderItemId(number),
      variantId: variants.white_s!,
      quantity: 1,
      reason: "colour",
    })
    await approveExchange(support, { exchangeNumber })
    const ex = await exchange(exchangeNumber)
    await deliverParcel((await parcels(ex.id))[0]!.id)
    await passExchangeQc(packer, { exchangeNumber })
    const wallet = await db().execute<{ balance: number }>(
      sql`select balance_paise as balance from wallet_accounts where user_id = ${customer.userId}`,
    )
    expect(wallet.rows[0]!.balance).toBe(79_900 - 59_900)
  })

  it("dearer option: pay first, then pickup; a failed QC sends the item back and refunds", async () => {
    const customer = await buyer()
    const number = await deliveredOrder(customer)
    const whiteL = await stock(variants.white_l!)
    const { exchangeNumber } = await requestExchange(customer, {
      orderNumber: number,
      orderItemId: await orderItemId(number),
      variantId: variants.white_l!,
      quantity: 1,
      reason: "colour",
    })
    await approveExchange(admin, { exchangeNumber })
    expect((await exchange(exchangeNumber)).status).toBe("awaiting_payment")

    const payment = await startExchangePayment(customer, { exchangeNumber })
    expect(payment.amountPaise).toBe(99_900 - 79_900)
    const { paymentId, signature } = await simulatePayment(customer, {
      orderNumber: number,
      providerOrderId: payment.providerOrderId,
      outcome: "captured",
    })
    expect(
      await verifyPayment(customer, {
        orderNumber: number,
        providerOrderId: payment.providerOrderId,
        providerPaymentId: paymentId,
        signature,
      }),
    ).toEqual({ status: "confirmed" })
    const ex = await exchange(exchangeNumber)
    expect(ex.status).toBe("approved")
    // The pickup is booked by the worker; here we book it directly.
    const [pickup] = await parcels(ex.id)
    await advanceShipment(pickup!.id)
    expect((await exchange(exchangeNumber)).status).toBe("pickup_scheduled")
    await deliverParcel(pickup!.id)

    await failExchangeQc(packer, {
      exchangeNumber,
      note: "The item was worn and washed.",
    })
    expect((await exchange(exchangeNumber)).status).toBe("qc_failed")
    expect(await stock(variants.white_l!)).toEqual(whiteL)
    const refunds = await db().execute<{ amount_paise: number }>(sql`
      select r.amount_paise from refunds r join exchange_requests e on e.difference_payment_id = r.payment_id
      where e.id = ${ex.id}`)
    expect(refunds.rows[0]!.amount_paise).toBe(99_900 - 79_900)
    const sendBack = (await parcels(ex.id))[1]
    expect(sendBack).toMatchObject({ direction: "replacement" })
  })

  it("lets the customer cancel before approval, and staff reject with a reason", async () => {
    const customer = await buyer()
    const number = await deliveredOrder(customer)
    const itemId = await orderItemId(number)
    const first = await requestExchange(customer, {
      orderNumber: number,
      orderItemId: itemId,
      variantId: variants.black_l!,
      quantity: 1,
      reason: "too_small",
    })
    await cancelMyExchange(customer, { exchangeNumber: first.exchangeNumber })
    expect((await exchange(first.exchangeNumber)).status).toBe("cancelled")

    const second = await requestExchange(customer, {
      orderNumber: number,
      orderItemId: itemId,
      variantId: variants.white_l!,
      quantity: 1,
      reason: "colour",
    })
    const whiteL = await stock(variants.white_l!)
    await approveExchange(support, { exchangeNumber: second.exchangeNumber })
    expect((await stock(variants.white_l!)).reserved).toBe(whiteL.reserved + 1)
    await rejectExchange(support, {
      exchangeNumber: second.exchangeNumber,
      note: "This colour is being discontinued.",
    })
    expect(await stock(variants.white_l!)).toEqual(whiteL)
    expect(
      await code(
        approveExchange(packer, { exchangeNumber: second.exchangeNumber }),
      ),
    ).toBe("FORBIDDEN")
  })
})

describe("reviews", () => {
  it("lets a verified buyer review once; ratings count only approved reviews", async () => {
    const customer = await buyer()
    const undelivered = await paidOrder(customer, variants.black_m!)
    expect(
      await code(
        submitReview(customer, {
          orderItemId: await orderItemId(undelivered),
          rating: 5,
          body: "Lovely heavy cotton, true to size.",
        }),
      ),
    ).toBe("INVALID_STATE")

    const number = await deliveredOrder(customer)
    const itemId = await orderItemId(number)
    const { id } = await submitReview(customer, {
      orderItemId: itemId,
      rating: 4,
      body: "Lovely heavy cotton, true to size.",
      fit: "true_to_size",
    })
    expect(
      await code(
        submitReview(customer, {
          orderItemId: itemId,
          rating: 5,
          body: "Again, again!",
        }),
      ),
    ).toBe("CONFLICT")
    expect((await loadProductReviews(fx.productId)).count).toBe(0)

    await moderateReview(admin, { reviewId: id, decision: "approved" })
    const live = await loadProductReviews(fx.productId)
    expect(live.reviews.map((r) => r.id)).toContain(id)
    const product = await db().execute<{
      rating_count: number
      rating_average: number
    }>(
      sql`select rating_count, rating_average from products where id = ${fx.productId}`,
    )
    expect(product.rows[0]!.rating_count).toBeGreaterThanOrEqual(1)

    await moderateReview(admin, { reviewId: id, decision: "rejected" })
    expect(
      (await loadProductReviews(fx.productId)).reviews.map((r) => r.id),
    ).not.toContain(id)
    expect(
      await code(
        moderateReview(packer, { reviewId: id, decision: "approved" }),
      ),
    ).toBe("FORBIDDEN")
  })

  it("shows a first name and initial, never an email", () => {
    expect(displayNameFor("Asha Rao")).toBe("Asha R.")
    expect(displayNameFor("someone@example.com")).toBe("Verified buyer")
    expect(displayNameFor("Riya")).toBe("Riya")
  })
})

describe("tracking links and photos", () => {
  it("opens tracking with the signed token only", async () => {
    const number = await deliveredOrder(await buyer())
    const tracking = await getTracking(anonymousActor(), {
      orderNumber: number,
      token: trackingToken(number),
    })
    expect(tracking.parcels[0]).toMatchObject({
      kind: "order",
      status: "delivered",
    })
    expect(JSON.stringify(tracking)).not.toContain("Hazratganj")
    expect(
      await code(
        getTracking(anonymousActor(), {
          orderNumber: number,
          token: "x".repeat(22),
        }),
      ),
    ).toBe("NOT_FOUND")
  })

  it("keeps customer photos private to their owner and the staff handling them", async () => {
    const owner = await buyer()
    const photo = await uploadCustomerPhoto(owner, {
      bytes: await makeUniqueImage(),
    })
    expect(await readCustomerPhoto(owner, photo.id)).not.toBeNull()
    expect(await readCustomerPhoto(await buyer(), photo.id)).toBeNull()
    expect(await readCustomerPhoto(anonymousActor(), photo.id)).toBeNull()
    // Not linked to an exchange: support can't see it either.
    expect(await readCustomerPhoto(support, photo.id)).toBeNull()
  })
})

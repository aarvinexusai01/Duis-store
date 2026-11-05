import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addCartItem } from "@/features/cart"
import {
  getCheckoutQuote,
  placeOrder,
  simulatePayment,
  verifyPayment,
  type PlaceResult,
} from "@/features/checkout"
import { saveAddress } from "@/features/customers"
import { createDiscount } from "@/features/discounts"
import { cancelOrder } from "@/features/orders"
import { setUsdPricingEnabled } from "@/features/settings"
import { creditWallet } from "@/features/wallet"
import { paiseToUsdCents, usdCentsToPaise } from "@/lib/fx"
import type { UserActor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { brokenInvariants } from "@/server/db/invariants"
import { withTransaction } from "@/server/db/transaction"

import { asSystem, createUserActor, unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { code, sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

const db = () => getDb()
const RATE = 84_500_000
const UPLIFT = 1500
const FEE = 2500
let variantId: string
let pricePaise: number

type UsBuyer = UserActor & { addressId: string }

async function usBuyer(countryCode = "US"): Promise<UsBuyer> {
  const actor = (await createUserActor("customer")) as UserActor
  const { id } = await saveAddress(actor, {
    consent: true,
    fullName: "Sam Rivera",
    phone: "+1 415 555 0100",
    line1: "1 Market Street",
    city: "San Francisco",
    region: "CA",
    postalCode: "94105",
    countryCode,
  })
  return { ...actor, addressId: id }
}

const choicesFor = (buyer: UsBuyer, couponCode?: string) =>
  ({
    addressId: buyer.addressId,
    paymentMode: "prepaid",
    useWallet: true,
    couponCode,
  }) as const

async function place(buyer: UsBuyer, couponCode?: string) {
  const choices = choicesFor(buyer, couponCode)
  const view = await getCheckoutQuote(buyer, choices)
  const result = await placeOrder(buyer, {
    consent: true,
    ...choices,
    quoteHash: view.hash,
    idempotencyKey: randomUUID(),
  })
  return { view, result }
}

async function pay(buyer: UsBuyer, result: PlaceResult) {
  if (result.status !== "pay") throw new Error("nothing to pay")
  const { paymentId, signature } = await simulatePayment(buyer, {
    orderNumber: result.orderNumber,
    providerOrderId: result.payment.providerOrderId,
    outcome: "captured",
  })
  return verifyPayment(buyer, {
    orderNumber: result.orderNumber,
    providerOrderId: result.payment.providerOrderId,
    providerPaymentId: paymentId,
    signature,
  })
}

const setRate = (rateMicros: number) =>
  db().execute(sql`
    update store_settings set usd_rate_mode = 'manual', usd_manual_rate_micros = ${rateMicros} where id = 1`)

beforeAll(async () => {
  ;({ variantId } = await sellableProduct())
  pricePaise = (
    await db().execute<{ price_paise: number }>(
      sql`select price_paise from product_variants where id = ${variantId}`,
    )
  ).rows[0]!.price_paise
  await db().execute(sql`
    update store_settings set international_country_codes = '{US,AE}', default_uplift_bp = 0,
      usd_pricing_enabled = true where id = 1`)
  await setRate(RATE)
  await db().execute(sql`
    insert into country_pricing (country_code, uplift_bp, shipping_fee_cents) values ('US', ${UPLIFT}, ${FEE})
    on conflict (country_code) do update set uplift_bp = excluded.uplift_bp, shipping_fee_cents = excluded.shipping_fee_cents`)
})

afterAll(async () => {
  await db().execute(sql`
    update store_settings set international_country_codes = '{}', usd_pricing_enabled = false,
      usd_rate_mode = 'auto', usd_manual_rate_micros = null where id = 1`)
  await db().execute(sql`delete from country_pricing`)
})

describe("checkout outside India, in dollars", () => {
  it("quotes, charges and records the order in USD, with rupee books", async () => {
    const buyer = await usBuyer()
    await withTransaction((tx) =>
      creditWallet(tx, {
        userId: buyer.userId,
        amountPaise: 50_000,
        reason: "goodwill",
        idempotencyKey: `gw:${randomUUID()}`,
      }),
    )
    await addCartItem(buyer, { variantId, quantity: 2 })
    const { view, result } = await place(buyer)
    const unit = paiseToUsdCents(pricePaise, {
      rateMicros: RATE,
      upliftBp: UPLIFT,
    })
    expect(view.quote.currency).toBe("USD")
    expect(view.quote.lines[0]!.unitPricePaise).toBe(unit)
    expect(unit % 100).toBe(99)
    expect(view.quote.shippingFeePaise).toBe(FEE)
    expect(view.quote.totalPaise).toBe(unit * 2 + FEE)
    // Rupee wallet credit isn't offered on a dollar order.
    expect(view.walletBalancePaise).toBe(0)
    expect(view.quote.walletAppliedPaise).toBe(0)

    expect(result.status).toBe("pay")
    if (result.status !== "pay") return
    expect(result.payment).toMatchObject({
      currency: "USD",
      amountMinor: unit * 2 + FEE,
    })
    expect(await pay(buyer, result)).toEqual({ status: "confirmed" })

    const order = await db().execute<Record<string, number | string>>(sql`
      select currency, total_minor, online_amount_minor, total_paise, fx_rate_micros, price_uplift_bp,
        fx_source, tax_total_paise, wallet_applied_paise
      from orders where order_number = ${result.orderNumber}`)
    expect(order.rows[0]).toMatchObject({
      currency: "USD",
      total_minor: unit * 2 + FEE,
      online_amount_minor: unit * 2 + FEE,
      fx_rate_micros: RATE,
      price_uplift_bp: UPLIFT,
      fx_source: "manual",
      tax_total_paise: 0,
      wallet_applied_paise: 0,
    })
    // The books: each charged price at the order's own rate, line by line.
    expect(order.rows[0]!.total_paise).toBe(
      usdCentsToPaise(unit, RATE) * 2 + usdCentsToPaise(FEE, RATE),
    )
    const payment = await db().execute<{
      currency: string
      amount_paise: number
    }>(sql`
      select p.currency, p.amount_paise from payments p join orders o on o.id = p.order_id
      where o.order_number = ${result.orderNumber}`)
    expect(payment.rows).toEqual([
      { currency: "USD", amount_paise: unit * 2 + FEE },
    ])
    expect(await brokenInvariants()).toEqual([])
  })

  it("refunds a cancelled dollar order in dollars", async () => {
    const buyer = await usBuyer()
    await addCartItem(buyer, { variantId, quantity: 1 })
    const { result } = await place(buyer)
    await pay(buyer, result)
    const cancelled = await cancelOrder(buyer, {
      orderNumber: result.orderNumber,
    })
    const charged = paiseToUsdCents(pricePaise, {
      rateMicros: RATE,
      upliftBp: UPLIFT,
    })
    expect(cancelled.refundPaise).toBe(charged + FEE)
    const refund = await db().execute<{
      currency: string
      amount_paise: number
    }>(sql`
      select r.currency, r.amount_paise from refunds r join orders o on o.id = r.order_id
      where o.order_number = ${result.orderNumber}`)
    expect(refund.rows).toEqual([
      { currency: "USD", amount_paise: charged + FEE },
    ])
  })

  it("asks the customer to review the total when the rate moves", async () => {
    const buyer = await usBuyer()
    await addCartItem(buyer, { variantId, quantity: 1 })
    const choices = choicesFor(buyer)
    const view = await getCheckoutQuote(buyer, choices)
    await setRate(RATE + 2_000_000)
    try {
      expect(
        await code(
          placeOrder(buyer, {
            consent: true,
            ...choices,
            quoteHash: view.hash,
            idempotencyKey: randomUUID(),
          }),
        ),
      ).toBe("CONFLICT")
    } finally {
      await setRate(RATE)
    }
  })

  it("applies percentage coupons and explains rupee ones", async () => {
    const buyer = await usBuyer()
    await addCartItem(buyer, { variantId, quantity: 1 })
    const percent = unique("PCT")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
    const flat = unique("FLAT")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
    await createDiscount(asSystem(), {
      name: "Ten percent",
      kind: "coupon",
      code: percent,
      valueType: "percentage",
      value: 1000,
    })
    await createDiscount(asSystem(), {
      name: "Flat",
      kind: "coupon",
      code: flat,
      valueType: "fixed",
      value: 10_000,
    })
    const withPercent = await getCheckoutQuote(
      buyer,
      choicesFor(buyer, percent),
    )
    expect(withPercent.quote.couponCode).toBe(percent)
    expect(withPercent.quote.discountPaise).toBeGreaterThan(0)
    const withFlat = await getCheckoutQuote(buyer, choicesFor(buyer, flat))
    expect(withFlat.quote.couponCode).toBeNull()
    expect(withFlat.quote.issues).toContainEqual(
      expect.objectContaining({
        message: `${flat} applies to orders delivered in India.`,
      }),
    )
  })

  it("can't price a shipping country without its fee", async () => {
    const buyer = await usBuyer("AE")
    await addCartItem(buyer, { variantId, quantity: 1 })
    const view = await getCheckoutQuote(buyer, choicesFor(buyer))
    expect(view.quote.issues).toContainEqual(
      expect.objectContaining({
        code: "DELIVERY_UNAVAILABLE",
        message: "We don't ship to this country yet.",
      }),
    )
  })

  it("stays in rupees while switched off", async () => {
    await db().execute(
      sql`update store_settings set usd_pricing_enabled = false where id = 1`,
    )
    try {
      const buyer = await usBuyer()
      await addCartItem(buyer, { variantId, quantity: 1 })
      const view = await getCheckoutQuote(buyer, choicesFor(buyer))
      expect(view.quote.currency).toBe("INR")
      expect(view.quote.lines[0]!.unitPricePaise).toBe(pricePaise)
    } finally {
      await db().execute(
        sql`update store_settings set usd_pricing_enabled = true where id = 1`,
      )
    }
  })
})

describe("switching dollar checkout on", () => {
  it("checks the rate, a priced country and the gateway first", async () => {
    const admin = await createUserActor("store_admin")
    // The fake gateway accepts USD; the rate and the US fee are in place.
    await setUsdPricingEnabled(admin, { enabled: false })
    expect(await code(setUsdPricingEnabled(admin, { enabled: true }))).toBe(
      "ok",
    )
    await db().execute(
      sql`delete from country_pricing where country_code = 'US'`,
    )
    try {
      expect(await code(setUsdPricingEnabled(admin, { enabled: true }))).toBe(
        "INVALID_STATE",
      )
    } finally {
      await db().execute(sql`
        insert into country_pricing (country_code, uplift_bp, shipping_fee_cents) values ('US', ${UPLIFT}, ${FEE})`)
    }
    const editor = await createUserActor("content_editor")
    expect(await code(setUsdPricingEnabled(editor, { enabled: true }))).toBe(
      "FORBIDDEN",
    )
  })
})

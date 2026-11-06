import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildMetaPurchase } from "@/features/analytics"
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
import {
  adminGetOrder,
  adminListOrders,
  cancelOrder,
  getMyOrder,
  listMyOrders,
  recordManualShipment,
  refundOrder,
  simulateTracking,
} from "@/features/orders"
import { exportGstCsv } from "@/features/reports"
import {
  loadStorefrontUsdPricing,
  setUsdPricingEnabled,
} from "@/features/settings"
import { creditWallet } from "@/features/wallet"
import { formatMoney, paiseToUsdCents, usdCentsToPaise } from "@/lib/fx"
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

// What this file changes, put back afterwards for the other test files.
let original: Record<string, unknown>

beforeAll(async () => {
  const saved = await db().execute<Record<string, unknown>>(sql`
    select international_country_codes, default_uplift_bp, usd_pricing_enabled,
      usd_rate_mode, usd_manual_rate_micros from store_settings where id = 1`)
  original = saved.rows[0]!
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
  const codes = original.international_country_codes as string[]
  await db().execute(sql`
    update store_settings set international_country_codes = ${`{${codes.join(",")}}`}::text[],
      default_uplift_bp = ${original.default_uplift_bp as number},
      usd_pricing_enabled = ${original.usd_pricing_enabled as boolean},
      usd_rate_mode = ${original.usd_rate_mode as string},
      usd_manual_rate_micros = ${original.usd_manual_rate_micros as number | null}
    where id = 1`)
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

describe("dollar prices on the shop", () => {
  it("gives the storefront the rate and each country's increase, or nothing while off", async () => {
    await setRate(RATE)
    expect(await loadStorefrontUsdPricing(db())).toMatchObject({
      rateMicros: RATE,
      defaultUpliftBp: 0,
      countryUpliftBp: expect.objectContaining({ US: UPLIFT }),
    })
    await db().execute(
      sql`update store_settings set usd_pricing_enabled = false where id = 1`,
    )
    try {
      expect(await loadStorefrontUsdPricing(db())).toBeNull()
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

describe("after a dollar order is placed", () => {
  /** A paid US order of one unit; its number and what it charged. */
  async function paidUsOrder() {
    const buyer = await usBuyer()
    await db().execute(
      sql`update users set email = ${`${unique("us")}@duis.test`} where id = ${buyer.userId}`,
    )
    await addCartItem(buyer, { variantId, quantity: 1 })
    const { result } = await place(buyer)
    await pay(buyer, result)
    const unit = paiseToUsdCents(pricePaise, {
      rateMicros: RATE,
      upliftBp: UPLIFT,
    })
    return { buyer, orderNumber: result.orderNumber, charged: unit + FEE }
  }

  const emailProps = async (orderNumber: string, template: string) => {
    const found = await db().execute<{ props: Record<string, unknown> }>(sql`
      select j.data->'props' as props from pgboss.job j
      where j.name = 'notify.email' and j.data->>'template' = ${template}
        and j.data->'props'->>'orderNumber' = ${orderNumber}
      order by j.created_on desc limit 1`)
    return found.rows[0]?.props
  }

  it("tells Meta the purchase in dollars, as charged", async () => {
    const { orderNumber, charged } = await paidUsOrder()
    await db().execute(sql`
      update orders set marketing_context = ${JSON.stringify({ fbp: "fb.1.1700000000000.1", userAgent: "Mozilla/5.0 test" })}::jsonb
      where order_number = ${orderNumber}`)
    const found = await db().execute<{ id: string }>(
      sql`select id from orders where order_number = ${orderNumber}`,
    )
    const event = await buildMetaPurchase(found.rows[0]!.id)
    const unit = paiseToUsdCents(pricePaise, {
      rateMicros: RATE,
      upliftBp: UPLIFT,
    })
    expect(event?.custom_data).toMatchObject({
      currency: "USD",
      value: charged / 100,
      contents: [
        expect.objectContaining({ quantity: 1, item_price: unit / 100 }),
      ],
    })
  })

  it("emails and shows the customer dollars", async () => {
    const { buyer, orderNumber, charged } = await paidUsOrder()
    const total = formatMoney(charged, "USD")
    expect(await emailProps(orderNumber, "order-confirmed")).toMatchObject({
      total,
    })
    const detail = await getMyOrder(buyer, { orderNumber })
    expect(detail).toMatchObject({
      currency: "USD",
      charged: { total: charged, shippingFee: FEE },
    })
    expect(detail.items[0]!.lineTotalCharged).toBe(charged - FEE)
    const list = await listMyOrders(buyer, {})
    expect(list.find((o) => o.orderNumber === orderNumber)).toMatchObject({
      currency: "USD",
      totalCharged: charged,
    })
  })

  it("refunds to the payment in dollars, never to the rupee wallet", async () => {
    const { orderNumber, charged } = await paidUsOrder()
    const admin = await createUserActor("store_admin")
    const detail = await adminGetOrder(admin, { orderNumber })
    expect(detail.money).toMatchObject({
      currency: "USD",
      charged: { total: charged },
      fx: { rateMicros: RATE, upliftBp: UPLIFT, source: "manual" },
      refundable: { toSourcePaise: charged, toWalletPaise: 0, currency: "USD" },
    })
    expect(
      await code(
        refundOrder(admin, {
          orderNumber,
          amountPaise: 500,
          destination: "wallet",
          reason: "goodwill",
          idempotencyKey: randomUUID(),
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    await refundOrder(admin, {
      orderNumber,
      amountPaise: 500,
      destination: "source",
      reason: "late parcel",
      idempotencyKey: randomUUID(),
    })
    const refund = await db().execute<{
      currency: string
      amount_paise: number
    }>(sql`
      select r.currency, r.amount_paise from refunds r join orders o on o.id = r.order_id
      where o.order_number = ${orderNumber}`)
    expect(refund.rows).toEqual([{ currency: "USD", amount_paise: 500 }])
    const listed = await adminListOrders(admin, { q: orderNumber, page: 1 })
    expect(listed.rows[0]).toMatchObject({
      charged: { currency: "USD", amountMinor: charged },
    })
  })

  it("lets staff enter a parcel booked by hand and follow it to delivered", async () => {
    const { orderNumber } = await paidUsOrder()
    const packer = await createUserActor("fulfilment_staff")
    const awb = `DHL${Date.now()}`
    const { shipmentId } = await recordManualShipment(packer, {
      orderNumber,
      carrier: "DHL Express",
      awb,
    })
    // The same tracking number can't go on a second parcel.
    const other = await paidUsOrder()
    expect(
      await code(
        recordManualShipment(packer, {
          orderNumber: other.orderNumber,
          carrier: "DHL Express",
          awb,
        }),
      ),
    ).toBe("CONFLICT")
    const parcel = async () =>
      (
        await db().execute<{
          status: string
          provider: string
          courier_name: string
        }>(
          sql`select status, provider, courier_name from shipments where id = ${shipmentId}`,
        )
      ).rows[0]!
    expect(await parcel()).toMatchObject({
      status: "ready_to_ship",
      provider: "manual",
      courier_name: "DHL Express",
    })
    for (let i = 0; i < 4; i += 1) {
      await simulateTracking(packer, { shipmentId, outcome: "next" })
    }
    expect((await parcel()).status).toBe("delivered")
    const order = await db().execute<{ status: string }>(
      sql`select status from orders where order_number = ${orderNumber}`,
    )
    expect(order.rows[0]!.status).toBe("delivered")
    expect(await emailProps(orderNumber, "order-shipped")).toMatchObject({
      courier: "DHL Express",
      awb,
    })
  })

  it("is only for exports", async () => {
    const packer = await createUserActor("fulfilment_staff")
    const india = await buyerInIndia()
    expect(
      await code(
        recordManualShipment(packer, {
          orderNumber: india,
          carrier: "DTDC",
          awb: `IN${Date.now()}`,
        }),
      ),
    ).toBe("INVALID_STATE")
  })

  it("reports dollar orders with their foreign value and rate", async () => {
    const { orderNumber, charged } = await paidUsOrder()
    const admin = await createUserActor("store_admin")
    const today = new Date().toISOString().slice(0, 10)
    const gst = await exportGstCsv(admin, { from: today, to: today })
    const header = gst.csv.split("\r\n")[0]!.split(",")
    expect(header.slice(-3)).toEqual([
      "foreign_currency",
      "foreign_value",
      "fx_rate_inr_per_unit",
    ])
    const lines = gst.csv.split("\r\n").filter((l) => l.startsWith(orderNumber))
    expect(lines).toHaveLength(2) // the goods and the shipping charge
    expect(
      lines[0]!.endsWith(`USD,${((charged - FEE) / 100).toFixed(2)},84.500000`),
    ).toBe(true)
    expect(lines[1]!.endsWith(`USD,${(FEE / 100).toFixed(2)},84.500000`)).toBe(
      true,
    )
  })
})

/** A paid order delivered in India, for the export-only checks. */
async function buyerInIndia(): Promise<string> {
  const actor = (await createUserActor("customer")) as UserActor
  const { id } = await saveAddress(actor, {
    consent: true,
    fullName: "Asha Rao",
    phone: "9876543210",
    line1: "1 Hazratganj",
    city: "Lucknow",
    stateCode: "IN-UP",
    postalCode: "226001",
    countryCode: "IN",
  })
  const buyer = { ...actor, addressId: id }
  await addCartItem(buyer, { variantId, quantity: 1 })
  const { result } = await place(buyer)
  await pay(buyer, result)
  return result.orderNumber
}

import { describe, expect, it } from "vitest"

import {
  quote,
  quoteFingerprint,
  type PricingCoupon,
  type PricingLine,
  type QuoteInput,
} from "./engine"
import { inrLedger, toUsdInput, withFx, type UsdTerms } from "./usd"

const terms: UsdTerms = {
  rateMicros: 84_500_000,
  upliftBp: 1500,
  source: "ecb",
  asOf: "2026-11-04",
  shippingFeeCents: 2500,
}

function line(overrides: Partial<PricingLine> = {}): PricingLine {
  return {
    position: 0,
    variantId: "v1",
    productId: "p1",
    sku: "SKU-1",
    title: "Tee",
    variantLabel: "Black / M",
    imageKey: null,
    hsnCode: "6109",
    unitPricePaise: 249_900,
    unitMrpPaise: 299_900,
    quantity: 2,
    categoryIds: [],
    collectionIds: [],
    ...overrides,
  }
}

function rupeeInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    lines: [
      line(),
      line({
        position: 1,
        variantId: "v2",
        unitPricePaise: 99_900,
        unitMrpPaise: 99_900,
        quantity: 1,
      }),
    ],
    automaticDiscounts: [],
    coupon: null,
    destination: { countryCode: "US", stateCode: null },
    registeredStateCode: "IN-UP",
    shipping: { freeThresholdPaise: 99_900, ratePaise: null },
    paymentMode: "prepaid",
    cod: {
      eligible: false,
      advanceType: "fixed",
      advanceValue: 10_000,
      feePaise: 500,
      maxOrderPaise: 250_000,
    },
    wallet: { balancePaise: 50_000, requestedPaise: 50_000 },
    taxRules: [],
    ...overrides,
  }
}

const coupon = (overrides: Partial<PricingCoupon>): PricingCoupon => ({
  id: "d1",
  couponId: "c1",
  code: "SAVE10",
  name: "Save 10",
  valueType: "percentage",
  value: 1000,
  maxDiscountPaise: null,
  minOrderPaise: 0,
  appliesTo: "all",
  targets: [],
  combinable: true,
  priority: 0,
  ...overrides,
})

const priced = (overrides: Partial<QuoteInput> = {}) => {
  const converted = toUsdInput(rupeeInput(overrides), terms)
  const q = withFx(quote(converted.input), terms)
  q.issues.push(...converted.issues)
  return q
}

describe("a USD quote", () => {
  it("charges converted .99 prices, the flat fee, no tax and no wallet", () => {
    const q = priced()
    expect(q.currency).toBe("USD")
    // ₹2,499 → $34.99; ₹999 at +15% → $13.59… → $13.99
    expect(q.lines.map((l) => l.unitPricePaise)).toEqual([3499, 1399])
    expect(q.subtotalPaise).toBe(3499 * 2 + 1399)
    expect(q.shippingFeePaise).toBe(2500)
    expect(q.totalPaise).toBe(3499 * 2 + 1399 + 2500)
    expect(q.taxTotalPaise).toBe(0)
    expect(q.walletAppliedPaise).toBe(0)
    expect(q.onlineAmountPaise).toBe(q.totalPaise)
    expect(q.issues.filter((i) => i.blocking)).toEqual([])
  })

  it("applies percentage coupons, with their minimum converted, but not rupee ones", () => {
    const percent = priced({
      coupon: coupon({ minOrderPaise: 100_000, maxDiscountPaise: 50_000 }),
    })
    expect(percent.couponCode).toBe("SAVE10")
    // 10% of $83.97 = $8.39, under the cap of ₹500 → $5.91: capped.
    expect(percent.discountPaise).toBe(591)

    const fixed = priced({
      coupon: coupon({ valueType: "fixed", value: 20_000, code: "FLAT200" }),
    })
    expect(fixed.couponCode).toBeNull()
    expect(fixed.discountPaise).toBe(0)
    expect(fixed.issues).toContainEqual(
      expect.objectContaining({
        code: "COUPON_NOT_APPLICABLE",
        message: "FLAT200 applies to orders delivered in India.",
      }),
    )
  })

  it("refuses dollars for a delivery in India", () => {
    const q = priced({ destination: { countryCode: "IN", stateCode: "IN-UP" } })
    expect(q.issues).toContainEqual(
      expect.objectContaining({ code: "DELIVERY_UNAVAILABLE", blocking: true }),
    )
  })

  it("hashes the rate and the increase, and leaves rupee hashes alone", () => {
    const a = priced()
    const b = withFx(a, { ...terms, rateMicros: 84_600_000 })
    expect(quoteFingerprint(a)).not.toBe(quoteFingerprint(b))
    const rupees = quote(
      rupeeInput({
        destination: { countryCode: "IN", stateCode: "IN-UP" },
        shipping: { freeThresholdPaise: 0, ratePaise: 0 },
      }),
    )
    expect(quoteFingerprint(rupees)).not.toContain("USD")
  })
})

describe("the rupee books for it", () => {
  it("adds up exactly as the order CHECKs require", () => {
    const q = priced({ coupon: coupon({ value: 1500 }) })
    const books = inrLedger(q)
    books.lines.forEach((l, i) => {
      // order_items_line_check
      expect(l.lineTotalPaise).toBe(
        l.unitPricePaise * q.lines[i]!.quantity - l.discountPaise,
      )
    })
    // orders_total_check, with no COD fee abroad
    expect(books.totalPaise).toBe(
      books.subtotalPaise - books.discountPaise + books.shippingFeePaise,
    )
    expect(books.discounts.reduce((s, d) => s + d.amountPaise, 0)).toBe(
      books.discountPaise,
    )
    // $34.99 at ₹84.50 = ₹2,956.66
    expect(books.lines[0]!.unitPricePaise).toBe(295_666)
  })

  it("is only for USD quotes", () => {
    expect(() => inrLedger(quote(rupeeInput()))).toThrow()
  })
})

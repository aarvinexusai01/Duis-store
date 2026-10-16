import { describe, expect, it } from "vitest"

import {
  allocate,
  quote,
  quoteFingerprint,
  splitTax,
  taxRateFor,
  type PricingCoupon,
  type PricingDiscount,
  type PricingLine,
  type QuoteInput,
} from "./engine"

const APPAREL = [
  {
    hsnPrefix: "61",
    priceThresholdPaise: 250_000,
    rateBelowBp: 500,
    rateAboveBp: 1800,
  },
]

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
    unitPricePaise: 79_900,
    unitMrpPaise: 99_900,
    quantity: 1,
    categoryIds: ["c-tees"],
    collectionIds: [],
    ...overrides,
  }
}

function input(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    lines: [line()],
    automaticDiscounts: [],
    coupon: null,
    destination: { countryCode: "IN", stateCode: "IN-KA" },
    registeredStateCode: "IN-UP",
    shipping: { freeThresholdPaise: 99_900, ratePaise: 6_900 },
    paymentMode: "prepaid",
    cod: {
      eligible: true,
      advanceType: "fixed",
      advanceValue: 10_000,
      feePaise: 500,
      maxOrderPaise: 250_000,
    },
    wallet: { balancePaise: 0, requestedPaise: 0 },
    taxRules: APPAREL,
    ...overrides,
  }
}

const sale: PricingDiscount = {
  id: "d-sale",
  name: "Tee sale",
  valueType: "percentage",
  value: 1_000,
  maxDiscountPaise: null,
  minOrderPaise: 0,
  appliesTo: "targets",
  targets: [{ type: "category", id: "c-tees" }],
  combinable: false,
  priority: 0,
}

const coupon = (overrides: Partial<PricingCoupon> = {}): PricingCoupon => ({
  id: "d-coupon",
  couponId: "cp1",
  code: "WELCOME10",
  name: "Welcome",
  valueType: "percentage",
  value: 1_000,
  maxDiscountPaise: null,
  minOrderPaise: 0,
  appliesTo: "all",
  targets: [],
  combinable: false,
  priority: 0,
  ...overrides,
})

describe("allocate", () => {
  it("splits exactly, remainder to the largest share", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(1_000, [300, 700])).toEqual([300, 700])
    expect(allocate(7, [0, 0])).toEqual([0, 0])
  })
})

describe("GST", () => {
  it("picks the slab on the value before tax", () => {
    expect(taxRateFor(APPAREL, "6109", 79_900)).toBe(500)
    // ₹2,625 including 5% is exactly ₹2,500 before tax: still 5%.
    expect(taxRateFor(APPAREL, "6109", 262_500)).toBe(500)
    expect(taxRateFor(APPAREL, "6109", 262_600)).toBe(1800)
    expect(taxRateFor(APPAREL, "4202", 79_900)).toBe(0)
  })

  it("splits inclusive prices into taxable value and tax that add back up", () => {
    expect(splitTax(105_000, 500, true)).toEqual({
      taxablePaise: 100_000,
      cgstPaise: 2_500,
      sgstPaise: 2_500,
      igstPaise: 0,
    })
    const odd = splitTax(79_900, 500, true)
    expect(odd.taxablePaise + odd.cgstPaise + odd.sgstPaise).toBe(79_900)
    expect(splitTax(79_900, 500, false).igstPaise).toBe(
      79_900 - odd.taxablePaise,
    )
  })
})

describe("quote", () => {
  it("charges the live rate below the free-shipping threshold, IGST out of state", () => {
    const q = quote(input())
    expect(q).toMatchObject({
      subtotalPaise: 79_900,
      shippingFeePaise: 6_900,
      totalPaise: 86_800,
      onlineAmountPaise: 86_800,
      intraState: false,
      issues: [],
    })
    expect(q.lines[0]).toMatchObject({ taxRateBp: 500, cgstPaise: 0 })
    expect(q.fees.taxRateBp).toBe(500)
    expect(q.taxTotalPaise).toBe(q.lines[0]!.igstPaise + q.fees.igstPaise)
  })

  it("ships free at the threshold and splits CGST/SGST within Uttar Pradesh", () => {
    const q = quote(
      input({
        lines: [line({ quantity: 2 })],
        destination: { countryCode: "IN", stateCode: "IN-UP" },
      }),
    )
    expect(q.shippingFeePaise).toBe(0)
    expect(q.intraState).toBe(true)
    expect(q.lines[0]!.igstPaise).toBe(0)
    expect(q.lines[0]!.cgstPaise + q.lines[0]!.sgstPaise).toBeGreaterThan(0)
  })

  it("never invents a delivery charge", () => {
    const q = quote(
      input({ shipping: { freeThresholdPaise: 99_900, ratePaise: null } }),
    )
    expect(q.issues).toEqual([
      expect.objectContaining({ code: "DELIVERY_UNAVAILABLE", blocking: true }),
    ])
  })

  it("applies the best automatic discount per line and keeps coupons off sale lines", () => {
    const lines = [
      line({ position: 0, variantId: "v1" }),
      line({
        position: 1,
        variantId: "v2",
        productId: "p2",
        categoryIds: ["c-shirts"],
        unitPricePaise: 120_000,
      }),
    ]
    const q = quote(
      input({ lines, automaticDiscounts: [sale], coupon: coupon() }),
    )
    expect(q.lines[0]!.discountPaise).toBe(7_990) // 10% sale only
    expect(q.lines[1]!.discountPaise).toBe(12_000) // 10% coupon only
    expect(q.discounts.map((d) => [d.label, d.amountPaise])).toEqual([
      ["Tee sale", 7_990],
      ["Coupon WELCOME10", 12_000],
    ])
    expect(q.couponCode).toBe("WELCOME10")
  })

  it("explains a coupon that doesn't apply instead of failing the order", () => {
    const q = quote(input({ automaticDiscounts: [sale], coupon: coupon() }))
    expect(q.couponCode).toBeNull()
    expect(q.issues).toEqual([
      expect.objectContaining({
        code: "COUPON_NOT_APPLICABLE",
        blocking: false,
      }),
    ])
    const short = quote(input({ coupon: coupon({ minOrderPaise: 150_000 }) }))
    expect(short.issues[0]!.message).toMatch(/Add items worth ₹701 more/)
  })

  it("spreads a capped fixed coupon pro rata and reconciles every line", () => {
    const lines = [
      line({ position: 0, unitPricePaise: 50_000 }),
      line({ position: 1, variantId: "v2", unitPricePaise: 100_001 }),
    ]
    const q = quote(
      input({
        lines,
        coupon: coupon({
          valueType: "fixed",
          value: 20_000,
          maxDiscountPaise: 15_000,
        }),
      }),
    )
    const amounts = q.lines.map((l) => l.discountPaise)
    expect(amounts.reduce((a, b) => a + b)).toBe(15_000)
    for (const l of q.lines) {
      expect(l.taxablePaise + l.cgstPaise + l.sgstPaise + l.igstPaise).toBe(
        l.lineTotalPaise,
      )
    }
  })

  it("builds the partial-COD plan: advance online, wallet off the cash part", () => {
    const q = quote(
      input({
        paymentMode: "partial_cod",
        wallet: { balancePaise: 50_000, requestedPaise: 50_000 },
      }),
    )
    // 79,900 + 6,900 shipping + 500 COD fee
    expect(q).toMatchObject({
      totalPaise: 87_300,
      codFeePaise: 500,
      onlineAmountPaise: 10_000,
      walletAppliedPaise: 50_000,
      codDuePaise: 27_300,
    })
    expect(q.walletAppliedPaise + q.onlineAmountPaise + q.codDuePaise).toBe(
      q.totalPaise,
    )
  })

  it("refuses partial COD abroad, over the cap or when ineligible", () => {
    const abroad = quote(
      input({
        paymentMode: "partial_cod",
        destination: { countryCode: "US", stateCode: null },
      }),
    )
    expect(abroad.issues[0]).toMatchObject({
      code: "COD_UNAVAILABLE",
      message: /India only/,
    })
    const big = quote(
      input({
        paymentMode: "partial_cod",
        lines: [line({ unitPricePaise: 300_000 })],
      }),
    )
    expect(big.issues[0]!.message).toMatch(/up to ₹2500/)
    const blocked = quote(
      input({
        paymentMode: "partial_cod",
        cod: {
          ...input().cod,
          eligible: false,
          ineligibleReason: "Verify your phone first.",
        },
      }),
    )
    expect(blocked.issues[0]!.message).toBe("Verify your phone first.")
  })

  it("lets the wallet pay a prepaid order in full", () => {
    const q = quote(
      input({ wallet: { balancePaise: 1_000_000, requestedPaise: 1_000_000 } }),
    )
    expect(q).toMatchObject({
      walletAppliedPaise: 86_800,
      onlineAmountPaise: 0,
    })
  })

  it("zero-rates exports and always charges the live international rate", () => {
    const q = quote(
      input({
        lines: [line({ quantity: 3 })],
        destination: { countryCode: "GB", stateCode: null },
        shipping: { freeThresholdPaise: 99_900, ratePaise: 250_000 },
      }),
    )
    expect(q).toMatchObject({
      isExport: true,
      shippingFeePaise: 250_000,
      taxTotalPaise: 0,
    })
  })

  it("fingerprints only what the customer pays", () => {
    const a = quote(input())
    const b = quote(input({ lines: [line({ title: "Renamed" })] }))
    const c = quote(
      input({ shipping: { freeThresholdPaise: 99_900, ratePaise: 7_000 } }),
    )
    expect(quoteFingerprint(a)).toBe(quoteFingerprint(b))
    expect(quoteFingerprint(a)).not.toBe(quoteFingerprint(c))
  })
})

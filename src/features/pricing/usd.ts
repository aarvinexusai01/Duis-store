import {
  paiseToUsdCents,
  paiseToUsdCentsPlain,
  usdCentsToPaise,
  type UsdPricing,
} from "@/lib/fx"

import type {
  PricingCoupon,
  PricingDiscount,
  Quote,
  QuoteInput,
  QuoteIssue,
} from "./engine"

/**
 * US-dollar orders (doc/06 Phase 13, ADR-0034). Pure, like the engine:
 *
 * 1. `toUsdInput` turns a rupee checkout into a dollar one. Prices are
 *    converted with the country's increase and rounded up to .99;
 *    percentage discounts keep their rate, their minimum and cap converted
 *    without the increase or rounding; fixed-amount discounts (in rupees)
 *    don't apply; shipping is the country's flat fee; no wallet.
 * 2. The engine prices it in cents.
 * 3. `inrLedger` gives the rupee equivalent at the same rate, line by line,
 *    for the books: every CHECK on orders and order_items holds, and tax is
 *    zero (exports under LUT, ADR-0018).
 */

export type UsdTerms = UsdPricing & {
  source: string
  asOf: string
  shippingFeeCents: number
}

function convertDiscount<T extends PricingDiscount>(
  discount: T,
  rateMicros: number,
): T {
  const plain = { rateMicros, upliftBp: 0 }
  return {
    ...discount,
    minOrderPaise: paiseToUsdCentsPlain(discount.minOrderPaise, plain, "ceil"),
    maxDiscountPaise:
      discount.maxDiscountPaise === null
        ? null
        : paiseToUsdCentsPlain(discount.maxDiscountPaise, plain, "floor"),
  }
}

export function toUsdInput(
  input: QuoteInput,
  terms: UsdTerms,
): { input: QuoteInput; issues: QuoteIssue[] } {
  const issues: QuoteIssue[] = []
  let coupon: PricingCoupon | null = null
  if (input.coupon?.valueType === "fixed") {
    issues.push({
      code: "COUPON_NOT_APPLICABLE",
      message: `${input.coupon.code} applies to orders delivered in India.`,
      blocking: false,
    })
  } else if (input.coupon) {
    coupon = convertDiscount(input.coupon, terms.rateMicros)
  }
  return {
    issues,
    input: {
      ...input,
      currency: "USD",
      lines: input.lines.map((line) => ({
        ...line,
        unitPricePaise: paiseToUsdCents(line.unitPricePaise, terms),
        unitMrpPaise: paiseToUsdCents(line.unitMrpPaise, terms),
      })),
      automaticDiscounts: input.automaticDiscounts
        .filter((discount) => discount.valueType === "percentage")
        .map((discount) => convertDiscount(discount, terms.rateMicros)),
      coupon,
      shipping: {
        // No free shipping abroad: the flat fee always applies.
        freeThresholdPaise: Number.MAX_SAFE_INTEGER,
        ratePaise: terms.shippingFeeCents,
      },
      wallet: { balancePaise: 0, requestedPaise: 0 },
    },
  }
}

/** A USD quote stamped with the terms it was priced at. */
export function withFx(q: Quote, terms: UsdTerms): Quote {
  return {
    ...q,
    fx: {
      rateMicros: terms.rateMicros,
      upliftBp: terms.upliftBp,
      source: terms.source,
      asOf: terms.asOf,
    },
  }
}

export type InrLedger = {
  lines: {
    position: number
    unitPricePaise: number
    unitMrpPaise: number
    discountPaise: number
    lineTotalPaise: number
  }[]
  discounts: { amountPaise: number; allocation: Record<string, number> }[]
  subtotalPaise: number
  discountPaise: number
  shippingFeePaise: number
  totalPaise: number
}

/** The rupee books for a USD quote, at its own rate. */
export function inrLedger(q: Quote): InrLedger {
  if (q.currency !== "USD" || !q.fx) throw new Error("not a USD quote")
  const rate = q.fx.rateMicros
  const toPaise = (cents: number) => usdCentsToPaise(cents, rate)
  // Each discount's share of each line, converted on its own, so the
  // discounts and the lines add up to the same rupees.
  const discounts = q.discounts.map((discount) => {
    const allocation = Object.fromEntries(
      Object.entries(discount.allocation).map(([position, cents]) => [
        position,
        toPaise(cents),
      ]),
    )
    return {
      allocation,
      amountPaise: Object.values(allocation).reduce((a, b) => a + b, 0),
    }
  })
  const lines = q.lines.map((line) => {
    const unitPricePaise = toPaise(line.unitPricePaise)
    const discountPaise = discounts.reduce(
      (sum, d) => sum + (d.allocation[String(line.position)] ?? 0),
      0,
    )
    return {
      position: line.position,
      unitPricePaise,
      unitMrpPaise: toPaise(line.unitMrpPaise),
      discountPaise,
      lineTotalPaise: unitPricePaise * line.quantity - discountPaise,
    }
  })
  const subtotalPaise = lines.reduce(
    (sum, line, i) => sum + line.unitPricePaise * q.lines[i]!.quantity,
    0,
  )
  const discountPaise = lines.reduce((sum, line) => sum + line.discountPaise, 0)
  const shippingFeePaise = toPaise(q.shippingFeePaise)
  return {
    lines,
    discounts,
    subtotalPaise,
    discountPaise,
    shippingFeePaise,
    totalPaise: subtotalPaise - discountPaise + shippingFeePaise,
  }
}

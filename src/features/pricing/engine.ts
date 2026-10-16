/**
 * The pricing engine (doc/03 §1): a pure function from loaded data to a
 * complete quote. No I/O and no clock, so every rule is unit-tested, and the
 * same inputs always give the same quote. All money is integer paise;
 * divisions round in the customer's favour where a choice exists, and the
 * GST split always adds back up to the line total.
 */

export type PricingLine = {
  position: number
  variantId: string
  productId: string
  sku: string
  title: string
  variantLabel: string
  imageKey: string | null
  hsnCode: string
  unitPricePaise: number
  unitMrpPaise: number
  quantity: number
  categoryIds: string[]
  collectionIds: string[]
}

export type DiscountTarget = {
  type: "product" | "variant" | "category" | "collection"
  id: string
}

export type PricingDiscount = {
  id: string
  name: string
  valueType: "percentage" | "fixed"
  /** Basis points for percentages, paise for fixed amounts. */
  value: number
  maxDiscountPaise: number | null
  minOrderPaise: number
  appliesTo: "all" | "targets"
  targets: DiscountTarget[]
  combinable: boolean
  priority: number
}

export type PricingCoupon = PricingDiscount & { couponId: string; code: string }

export type TaxRule = {
  hsnPrefix: string
  priceThresholdPaise: number | null
  rateBelowBp: number
  rateAboveBp: number
}

export type PaymentModeInput = "prepaid" | "partial_cod"

export type QuoteInput = {
  lines: PricingLine[]
  automaticDiscounts: PricingDiscount[]
  /** Already checked for dates, status and usage limits by the service. */
  coupon: PricingCoupon | null
  destination: { countryCode: string; stateCode: string | null }
  registeredStateCode: string
  shipping: {
    freeThresholdPaise: number
    /** The courier's live rate for this parcel; null when none is available. */
    ratePaise: number | null
  }
  paymentMode: PaymentModeInput
  cod: {
    /** Serviceability, phone verification and blocklist checks, done upstream. */
    eligible: boolean
    ineligibleReason?: string
    advanceType: "fixed" | "percent"
    advanceValue: number
    feePaise: number
    maxOrderPaise: number
  }
  wallet: { balancePaise: number; requestedPaise: number }
  taxRules: TaxRule[]
}

export type QuoteLine = PricingLine & {
  subtotalPaise: number
  discountPaise: number
  lineTotalPaise: number
  taxRateBp: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
}

export type QuoteDiscount = {
  discountId: string
  couponId: string | null
  label: string
  amountPaise: number
  /** Amount per line position. */
  allocation: Record<string, number>
}

export type QuoteIssue = {
  code:
    | "EMPTY"
    | "UNAVAILABLE"
    | "DELIVERY_UNAVAILABLE"
    | "COD_UNAVAILABLE"
    | "COUPON_NOT_APPLICABLE"
  message: string
  /** Blocking issues stop the order; others (a coupon that didn't apply) don't. */
  blocking: boolean
}

export type Quote = {
  lines: QuoteLine[]
  discounts: QuoteDiscount[]
  couponCode: string | null
  subtotalPaise: number
  mrpTotalPaise: number
  discountPaise: number
  shippingFeePaise: number
  codFeePaise: number
  totalPaise: number
  taxTotalPaise: number
  fees: {
    taxRateBp: number
    taxablePaise: number
    cgstPaise: number
    sgstPaise: number
    igstPaise: number
  }
  paymentMode: PaymentModeInput
  walletAppliedPaise: number
  onlineAmountPaise: number
  codDuePaise: number
  isExport: boolean
  intraState: boolean
  issues: QuoteIssue[]
}

const BP = 10_000

function matches(discount: PricingDiscount, line: PricingLine): boolean {
  if (discount.appliesTo === "all") return true
  return discount.targets.some((target) => {
    switch (target.type) {
      case "product":
        return target.id === line.productId
      case "variant":
        return target.id === line.variantId
      case "category":
        return line.categoryIds.includes(target.id)
      case "collection":
        return line.collectionIds.includes(target.id)
    }
  })
}

/** Raw saving on an amount, never more than the amount itself. */
function saving(
  discount: PricingDiscount,
  amountPaise: number,
  quantity: number,
) {
  const raw =
    discount.valueType === "percentage"
      ? Math.floor((amountPaise * discount.value) / BP)
      : discount.value * quantity
  return Math.min(raw, amountPaise)
}

/**
 * Splits `total` across `weights` in proportion, flooring each share and
 * giving the remainder to the largest weight (doc/03 §1.3), so the parts
 * always add up exactly.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (total === 0 || sum === 0) return weights.map(() => 0)
  const shares = weights.map((w) => Math.floor((total * w) / sum))
  const remainder = total - shares.reduce((a, b) => a + b, 0)
  let largest = 0
  weights.forEach((w, i) => {
    if (w > weights[largest]!) largest = i
  })
  shares[largest]! += remainder
  return shares
}

/** Longest matching HSN prefix wins. */
export function taxRateFor(
  rules: TaxRule[],
  hsnCode: string,
  perPieceNetPaise: number,
): number {
  const rule = rules
    .filter((r) => hsnCode.startsWith(r.hsnPrefix))
    .sort((a, b) => b.hsnPrefix.length - a.hsnPrefix.length)[0]
  if (!rule) return 0
  if (rule.priceThresholdPaise === null) return rule.rateBelowBp
  // The slab is decided on the value before tax, tried at the lower rate.
  const valueBeforeTax = (perPieceNetPaise * BP) / (BP + rule.rateBelowBp)
  return valueBeforeTax <= rule.priceThresholdPaise
    ? rule.rateBelowBp
    : rule.rateAboveBp
}

/** Prices include GST: taxable = gross ÷ (1 + rate), split by place of supply. */
export function splitTax(
  grossPaise: number,
  rateBp: number,
  intraState: boolean,
) {
  const taxablePaise = Math.round((grossPaise * BP) / (BP + rateBp))
  const tax = grossPaise - taxablePaise
  if (!intraState) {
    return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax }
  }
  const cgstPaise = Math.floor(tax / 2)
  return { taxablePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0 }
}

export function quote(input: QuoteInput): Quote {
  const issues: QuoteIssue[] = []
  const isExport = input.destination.countryCode !== "IN"
  const intraState =
    !isExport && input.destination.stateCode === input.registeredStateCode

  const work = input.lines.map((line) => ({
    line,
    subtotal: line.unitPricePaise * line.quantity,
    automatic: 0,
    coupon: 0,
    automaticId: null as string | null,
  }))
  const subtotalPaise = work.reduce((sum, w) => sum + w.subtotal, 0)
  if (work.length === 0) {
    issues.push({
      code: "EMPTY",
      message: "Your bag is empty.",
      blocking: true,
    })
  }

  // 1. Automatic discounts: the best eligible one per line, by priority then saving.
  const discountsOut: QuoteDiscount[] = []
  const applicable = input.automaticDiscounts.filter(
    (d) => subtotalPaise >= d.minOrderPaise,
  )
  for (const w of work) {
    let best: { discount: PricingDiscount; amount: number } | null = null
    for (const discount of applicable) {
      if (!matches(discount, w.line)) continue
      const amount = saving(discount, w.subtotal, w.line.quantity)
      if (
        amount > 0 &&
        (!best ||
          discount.priority > best.discount.priority ||
          (discount.priority === best.discount.priority &&
            amount > best.amount))
      ) {
        best = { discount, amount }
      }
    }
    if (best) {
      w.automatic = best.amount
      w.automaticId = best.discount.id
    }
  }
  // Per-discount caps are shared pro rata by the lines that used it.
  for (const discount of applicable) {
    const users = work.filter((w) => w.automaticId === discount.id)
    if (users.length === 0) continue
    let total = users.reduce((sum, w) => sum + w.automatic, 0)
    if (
      discount.maxDiscountPaise !== null &&
      total > discount.maxDiscountPaise
    ) {
      total = discount.maxDiscountPaise
      const shares = allocate(
        total,
        users.map((w) => w.automatic),
      )
      users.forEach((w, i) => (w.automatic = shares[i]!))
    }
    discountsOut.push({
      discountId: discount.id,
      couponId: null,
      label: discount.name,
      amountPaise: total,
      allocation: Object.fromEntries(
        users.map((w) => [String(w.line.position), w.automatic]),
      ),
    })
  }

  // 2. Coupon: one per order, spread pro rata over the lines it covers.
  let couponCode: string | null = null
  const coupon = input.coupon
  if (coupon) {
    const afterAutomatic = work.reduce(
      (s, w) => s + w.subtotal - w.automatic,
      0,
    )
    const eligible = work.filter(
      (w) =>
        matches(coupon, w.line) && (coupon.combinable || w.automatic === 0),
    )
    const base = eligible.reduce((s, w) => s + w.subtotal - w.automatic, 0)
    let amount = 0
    if (afterAutomatic < coupon.minOrderPaise) {
      issues.push({
        code: "COUPON_NOT_APPLICABLE",
        message: `Add items worth ₹${Math.ceil((coupon.minOrderPaise - afterAutomatic) / 100)} more to use ${coupon.code}.`,
        blocking: false,
      })
    } else if (base === 0) {
      issues.push({
        code: "COUPON_NOT_APPLICABLE",
        message: `${coupon.code} doesn't apply to the items in your bag${coupon.combinable ? "" : " (it can't be combined with sale prices)"}.`,
        blocking: false,
      })
    } else {
      amount =
        coupon.valueType === "percentage"
          ? Math.floor((base * coupon.value) / BP)
          : Math.min(coupon.value, base)
      if (coupon.maxDiscountPaise !== null) {
        amount = Math.min(amount, coupon.maxDiscountPaise)
      }
    }
    if (amount > 0) {
      const shares = allocate(
        amount,
        eligible.map((w) => w.subtotal - w.automatic),
      )
      eligible.forEach((w, i) => (w.coupon = shares[i]!))
      couponCode = coupon.code
      discountsOut.push({
        discountId: coupon.id,
        couponId: coupon.couponId,
        label: `Coupon ${coupon.code}`,
        amountPaise: amount,
        allocation: Object.fromEntries(
          eligible.map((w) => [String(w.line.position), w.coupon]),
        ),
      })
    }
  }

  const discountPaise = work.reduce((s, w) => s + w.automatic + w.coupon, 0)
  const merchandisePaise = subtotalPaise - discountPaise

  // 3. Shipping: free in India at the threshold; otherwise the live rate only.
  let shippingFeePaise = 0
  const needsRate =
    isExport || merchandisePaise < input.shipping.freeThresholdPaise
  if (needsRate && work.length > 0) {
    if (input.shipping.ratePaise === null) {
      issues.push({
        code: "DELIVERY_UNAVAILABLE",
        message: "We can't deliver to this address yet.",
        blocking: true,
      })
    } else {
      shippingFeePaise = input.shipping.ratePaise
    }
  }

  // 4. Partial COD: India only, within the cap, if eligible upstream.
  let codFeePaise = 0
  if (input.paymentMode === "partial_cod") {
    const total = merchandisePaise + shippingFeePaise + input.cod.feePaise
    const reason = isExport
      ? "Cash on delivery is available in India only."
      : !input.cod.eligible
        ? (input.cod.ineligibleReason ??
          "Cash on delivery isn't available for this order.")
        : total > input.cod.maxOrderPaise
          ? `Cash on delivery is available on orders up to ₹${input.cod.maxOrderPaise / 100}.`
          : null
    if (reason) {
      issues.push({ code: "COD_UNAVAILABLE", message: reason, blocking: true })
    } else {
      codFeePaise = input.cod.feePaise
    }
  }
  const totalPaise = merchandisePaise + shippingFeePaise + codFeePaise

  // 5. GST, per line by its own slab; fees at the highest line rate (the
  //    principal supply). Exports under LUT are zero-rated (ADR-018).
  const lines: QuoteLine[] = work.map((w) => {
    const lineTotalPaise = w.subtotal - w.automatic - w.coupon
    const taxRateBp = isExport
      ? 0
      : taxRateFor(
          input.taxRules,
          w.line.hsnCode,
          Math.floor(lineTotalPaise / w.line.quantity),
        )
    return {
      ...w.line,
      subtotalPaise: w.subtotal,
      discountPaise: w.automatic + w.coupon,
      lineTotalPaise,
      taxRateBp,
      ...splitTax(lineTotalPaise, taxRateBp, intraState),
    }
  })
  const feeRateBp = lines.reduce((max, l) => Math.max(max, l.taxRateBp), 0)
  const feeTax = splitTax(shippingFeePaise + codFeePaise, feeRateBp, intraState)
  const taxTotalPaise =
    lines.reduce((s, l) => s + l.cgstPaise + l.sgstPaise + l.igstPaise, 0) +
    feeTax.cgstPaise +
    feeTax.sgstPaise +
    feeTax.igstPaise

  // 6. Wallet and payment plan. The partial-COD advance is always paid
  //    online; the wallet can only reduce the cash collected on delivery.
  let advance = 0
  if (input.paymentMode === "partial_cod" && codFeePaise >= 0) {
    advance =
      input.cod.advanceType === "fixed"
        ? input.cod.advanceValue
        : Math.ceil((totalPaise * input.cod.advanceValue) / BP)
    advance = Math.min(advance, totalPaise)
  }
  const walletRoom = totalPaise - advance
  const walletAppliedPaise = Math.max(
    0,
    Math.min(
      input.wallet.balancePaise,
      input.wallet.requestedPaise,
      walletRoom,
    ),
  )
  const onlineAmountPaise =
    input.paymentMode === "partial_cod"
      ? advance
      : totalPaise - walletAppliedPaise
  const codDuePaise =
    input.paymentMode === "partial_cod"
      ? totalPaise - walletAppliedPaise - advance
      : 0

  return {
    lines,
    discounts: discountsOut,
    couponCode,
    subtotalPaise,
    mrpTotalPaise: work.reduce(
      (s, w) =>
        s +
        Math.max(w.line.unitMrpPaise, w.line.unitPricePaise) * w.line.quantity,
      0,
    ),
    discountPaise,
    shippingFeePaise,
    codFeePaise,
    totalPaise,
    taxTotalPaise,
    fees: { taxRateBp: feeRateBp, ...feeTax },
    paymentMode: input.paymentMode,
    walletAppliedPaise,
    onlineAmountPaise,
    codDuePaise,
    isExport,
    intraState,
    issues,
  }
}

/**
 * Canonical text of everything that decides what the customer pays, for the
 * quote hash: the order is placed only if the quote the customer saw still
 * holds (doc/03 §1).
 */
export function quoteFingerprint(q: Quote): string {
  return JSON.stringify([
    q.lines.map((l) => [
      l.variantId,
      l.quantity,
      l.unitPricePaise,
      l.discountPaise,
    ]),
    q.couponCode,
    q.shippingFeePaise,
    q.codFeePaise,
    q.totalPaise,
    q.walletAppliedPaise,
    q.onlineAmountPaise,
    q.codDuePaise,
    q.paymentMode,
  ])
}

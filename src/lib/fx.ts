import { formatPaise } from "./money"

/**
 * US-dollar prices outside India (doc/06 Phase 13, ADR-0034). Pure, so the
 * server, the storefront and tests share one conversion. Rates are rupees per
 * dollar × 1,000,000 ("micros"); increases are basis points (1500 = 15%).
 * The arithmetic is BigInt: paise × 20,000 × 10⁶ passes 2⁵³ for big orders.
 */

export type Currency = "INR" | "USD"
export type UsdPricing = { rateMicros: number; upliftBp: number }

const assertInteger = (value: number, what: string) => {
  if (!Number.isInteger(value)) throw new Error(`${what} must be an integer`)
}

function checked({ rateMicros, upliftBp }: UsdPricing) {
  assertInteger(rateMicros, "rate")
  assertInteger(upliftBp, "increase")
  if (rateMicros <= 0) throw new Error("rate must be positive")
  if (upliftBp < 0) throw new Error("increase can't be negative")
}

/** Cents before rounding, as numerator / denominator. */
function exactCents(paise: number, pricing: UsdPricing) {
  assertInteger(paise, "paise")
  checked(pricing)
  return {
    num: BigInt(paise) * BigInt(10_000 + pricing.upliftBp) * 1_000_000n,
    den: 10_000n * BigInt(pricing.rateMicros),
  }
}

const ceilDiv = (num: bigint, den: bigint) => (num + den - 1n) / den

/**
 * A rupee price as the dollar price shown and charged: converted, increased
 * for the country, then rounded up to the next .99 ($34.01 → $34.99).
 */
export function paiseToUsdCents(paise: number, pricing: UsdPricing): number {
  if (paise === 0) return 0
  const { num, den } = exactCents(paise, pricing)
  const cents = ceilDiv(num, den)
  return Number((cents / 100n) * 100n + 99n)
}

/** The same conversion without .99, for coupon minimums ("ceil") and caps ("floor"). */
export function paiseToUsdCentsPlain(
  paise: number,
  pricing: UsdPricing,
  mode: "ceil" | "floor",
): number {
  const { num, den } = exactCents(paise, pricing)
  return Number(mode === "ceil" ? ceilDiv(num, den) : num / den)
}

/** The rupee equivalent of charged cents, for the books (half up). */
export function usdCentsToPaise(cents: number, rateMicros: number): number {
  assertInteger(cents, "cents")
  checked({ rateMicros, upliftBp: 0 })
  return Number((BigInt(cents) * BigInt(rateMicros) + 500_000n) / 1_000_000n)
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "$34.99", or the rupee format for INR. */
export function formatMoney(minor: number, currency: Currency): string {
  if (currency === "INR") return formatPaise(minor)
  assertInteger(minor, "cents")
  return usd.format(minor / 100)
}

/** "₹84.5000" for a rate in micros. */
export function formatRate(rateMicros: number): string {
  return `₹${(rateMicros / 1_000_000).toFixed(4)}`
}

/** "84.5" or "84.50" typed by staff → micros, or null if it isn't a rate. */
export function parseRate(text: string): number | null {
  const match = /^\s*(\d{1,3})(?:\.(\d{1,6}))?\s*$/.exec(text)
  if (!match) return null
  return Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"))
}

// --- Rate sources (fetched daily by the worker) -------------------------------

export type PublishedRate = { rateMicros: number; asOf: string }

/** Rupees per dollar from the ECB's daily XML, where both are quoted per euro. */
export function parseEcbUsdInr(xml: string): PublishedRate | null {
  const day = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1]
  const perEuro = (code: string) =>
    Number(
      new RegExp(
        `<Cube\\s+currency=['"]${code}['"]\\s+rate=['"]([0-9.]+)['"]`,
      ).exec(xml)?.[1],
    )
  const usd = perEuro("USD")
  const inr = perEuro("INR")
  if (!day || !(usd > 0) || !(inr > 0)) return null
  return { rateMicros: Math.round((inr / usd) * 1_000_000), asOf: day }
}

/** The same from Frankfurter (which republishes ECB rates), base USD. */
export function parseFrankfurterUsdInr(body: unknown): PublishedRate | null {
  const data = body as {
    base?: unknown
    date?: unknown
    rates?: { INR?: unknown }
  }
  const inr = Number(data?.rates?.INR)
  if (data?.base !== "USD" || typeof data.date !== "string" || !(inr > 0)) {
    return null
  }
  return { rateMicros: Math.round(inr * 1_000_000), asOf: data.date }
}

/** Plausible rupees per dollar, and the most a day's rate may move. */
export const RATE_BOUNDS = { minMicros: 50_000_000, maxMicros: 200_000_000 }
export const MAX_DAILY_MOVE_BP = 500

/** Why a fetched rate shouldn't be trusted, or null. */
export function rateProblem(
  rateMicros: number,
  previousMicros: number | null,
): string | null {
  if (rateMicros < RATE_BOUNDS.minMicros || rateMicros > RATE_BOUNDS.maxMicros)
    return `${formatRate(rateMicros)} is outside the plausible range`
  if (previousMicros) {
    const moveBp = Math.abs(rateMicros - previousMicros) * 10_000
    if (moveBp > previousMicros * MAX_DAILY_MOVE_BP)
      return `${formatRate(rateMicros)} moved more than 5% from ${formatRate(previousMicros)}`
  }
  return null
}

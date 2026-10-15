/**
 * Money is integer paise everywhere (doc/02 §7). These helpers only format;
 * they never do arithmetic on rupee floats.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

const inrWithPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** ₹1,23,456 — whole rupees when exact, otherwise ₹1,234.50. */
export function formatPaise(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error("Money must be integer paise")
  return paise % 100 === 0
    ? inr.format(paise / 100)
    : inrWithPaise.format(paise / 100)
}

/** Whole-percent discount from MRP, rounded down so we never overstate it. */
export function discountPercent(pricePaise: number, mrpPaise: number): number {
  if (mrpPaise <= 0 || pricePaise >= mrpPaise) return 0
  return Math.floor(((mrpPaise - pricePaise) * 100) / mrpPaise)
}

/**
 * Size-chart units (owner decision 2026-10-23): charts are stored in one unit
 * and the size guide switches between inches and centimetres. Centimetres
 * show one decimal (as on the owner's charts); inches show up to three, so
 * values like 23.625 survive. Cells that aren't plain numbers pass through.
 */
export type SizeUnit = "in" | "cm"

const CM_PER_INCH = 2.54

export function convertMeasurement(
  value: string,
  from: SizeUnit,
  to: SizeUnit,
): string {
  if (from === to) return value
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return value
  const n = Number(trimmed)
  if (to === "cm") {
    // Round half up on the exact decimal, not on the float (61.595 → 61.6).
    return (Math.round(n * CM_PER_INCH * 10 + 1e-9) / 10).toFixed(1)
  }
  return String(Math.round((n / CM_PER_INCH) * 1000) / 1000)
}

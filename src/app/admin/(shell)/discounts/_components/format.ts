import { formatPaise } from "@/lib/money"

/** "15% off" or "₹150 off": percentages are stored in basis points. */
export function describeValue(
  valueType: "percentage" | "fixed",
  value: number,
): string {
  return valueType === "percentage"
    ? `${value / 100}% off`
    : `${formatPaise(value)} off`
}

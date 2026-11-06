"use client"

import { useDisplayCurrency } from "@/components/brand/display-currency"
import type { Currency } from "@/lib/fx"
import { cn } from "@/lib/utils"

const OPTIONS: { currency: Currency; label: string; name: string }[] = [
  { currency: "INR", label: "₹ INR", name: "Indian rupees" },
  { currency: "USD", label: "$ USD", name: "US dollars" },
]

/**
 * Rupees or dollars (doc/06 Phase 13d). Hidden while the shop is rupees
 * only. It changes what is shown; checkout charges by delivery country.
 */
export function CurrencySwitch({
  tone = "dark",
  className,
}: {
  /** "dark" in the black header, "light" in the menu drawer. */
  tone?: "dark" | "light"
  className?: string
}) {
  const { currency, usd, setCurrency } = useDisplayCurrency()
  if (!usd) return null
  return (
    <div
      role="group"
      aria-label="Show prices in"
      className={cn(
        "flex border text-xs font-semibold",
        tone === "dark" ? "border-white/30" : "border-ink",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const on = option.currency === currency
        return (
          <button
            key={option.currency}
            type="button"
            aria-pressed={on}
            aria-label={option.name}
            onClick={() => setCurrency(option.currency)}
            className={cn(
              "px-2 py-1 whitespace-nowrap",
              on
                ? tone === "dark"
                  ? "bg-paper text-ink"
                  : "bg-ink text-paper"
                : tone === "dark"
                  ? "text-paper hover:bg-white/10"
                  : "text-ink hover:bg-muted",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

"use client"

import { discountPercent } from "@/lib/money"
import { cn } from "@/lib/utils"

import { useMoney } from "./display-currency"

type PriceProps = {
  pricePaise: number
  mrpPaise: number
  /** Variants differ in price: show "From ₹…". */
  from?: boolean
  size?: "sm" | "lg"
  className?: string
}

/**
 * Selling price, struck-through MRP and the discount, never rounded up. In
 * the visitor's currency (doc/06 Phase 13d); the discount is the rupee one,
 * so rounding to .99 can't change it.
 */
export function Price({
  pricePaise,
  mrpPaise,
  from = false,
  size = "sm",
  className,
}: PriceProps) {
  const money = useMoney()
  const off = discountPercent(pricePaise, mrpPaise)
  const small = size === "lg" ? "text-base" : "text-xs"
  return (
    <p
      data-price
      className={cn(
        "flex flex-wrap items-baseline gap-x-2",
        size === "lg" ? "text-2xl" : "text-sm",
        className,
      )}
    >
      <span className="font-semibold">
        {from && <span className="font-normal">From </span>}
        {money.format(pricePaise)}
      </span>
      {off > 0 && (
        <>
          <s className={cn("text-muted-foreground", small)}>
            <span className="sr-only">MRP </span>
            {money.format(mrpPaise)}
          </s>
          <span className={cn("font-semibold text-rust", small)}>
            {off}% off
          </span>
        </>
      )}
    </p>
  )
}

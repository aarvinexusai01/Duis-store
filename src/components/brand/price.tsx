import { discountPercent, formatPaise } from "@/lib/money"
import { cn } from "@/lib/utils"

type PriceProps = {
  pricePaise: number
  mrpPaise: number
  /** Variants differ in price: show "From ₹…". */
  from?: boolean
  size?: "sm" | "lg"
  className?: string
}

/** Selling price, struck-through MRP and the discount, never rounded up. */
export function Price({
  pricePaise,
  mrpPaise,
  from = false,
  size = "sm",
  className,
}: PriceProps) {
  const off = discountPercent(pricePaise, mrpPaise)
  const small = size === "lg" ? "text-base" : "text-xs"
  return (
    <p
      className={cn(
        "flex flex-wrap items-baseline gap-x-2",
        size === "lg" ? "text-2xl" : "text-sm",
        className,
      )}
    >
      <span className="font-semibold">
        {from && <span className="font-normal">From </span>}
        {formatPaise(pricePaise)}
      </span>
      {off > 0 && (
        <>
          <s className={cn("text-muted-foreground", small)}>
            <span className="sr-only">MRP </span>
            {formatPaise(mrpPaise)}
          </s>
          <span className={cn("font-semibold text-rust", small)}>
            {off}% off
          </span>
        </>
      )}
    </p>
  )
}

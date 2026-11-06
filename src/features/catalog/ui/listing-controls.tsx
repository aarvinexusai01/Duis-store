"use client"

import { SlidersHorizontalIcon } from "lucide-react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"

import { useMoney } from "@/components/brand/display-currency"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { usdCentsToListPaise } from "@/lib/display-currency"
import { listingUrl, type ListingParams, type Sort } from "@/lib/listing-params"

const SORT_LABELS: Record<Sort, string> = {
  featured: "Featured",
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  discount: "Biggest discount",
}

export function SortSelect({
  basePath,
  params,
  extraQuery,
}: {
  basePath: string
  params: ListingParams
  extraQuery?: Record<string, string>
}) {
  const router = useRouter()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Sort</span>
      <select
        value={params.sort}
        onChange={(event) =>
          router.push(
            listingUrl(
              basePath,
              { ...params, sort: event.target.value as Sort, page: 1 },
              extraQuery,
            ) as Route,
          )
        }
        className="h-9 border border-input bg-card px-2 text-sm"
      >
        {Object.entries(SORT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Price range; the URL keeps whole rupees (?price=500-999). A visitor shown
 * dollars types dollars (doc/06 Phase 13d), turned into the rupee range.
 */
export function PriceFilter(props: {
  basePath: string
  params: ListingParams
  extraQuery?: Record<string, string>
  range: { minPaise: number; maxPaise: number }
}) {
  const money = useMoney()
  // Restart the inputs when the currency arrives or changes.
  return <PriceFilterForm key={money.currency} {...props} money={money} />
}

function PriceFilterForm({
  basePath,
  params,
  range,
  extraQuery,
  money,
}: {
  basePath: string
  params: ListingParams
  extraQuery?: Record<string, string>
  range: { minPaise: number; maxPaise: number }
  money: ReturnType<typeof useMoney>
}) {
  const router = useRouter()
  const usd = money.usd
  const symbol = usd ? "$" : "₹"
  const toUnits = (paise: number | null) =>
    paise === null ? "" : String(Math.round(money.toMinor(paise) / 100))
  // Whole units typed → paise, rounded out to whole rupees for the URL.
  const toPaise = (units: string, round: (n: number) => number) => {
    if (!units) return null
    const whole = Math.max(0, Number(units))
    const paise = usd ? usdCentsToListPaise(whole * 100, usd) : whole * 100
    return round(paise / 100) * 100
  }
  const [min, setMin] = useState(toUnits(params.priceMinPaise))
  const [max, setMax] = useState(toUnits(params.priceMaxPaise))

  const apply = (event: React.FormEvent) => {
    event.preventDefault()
    const minPaise = toPaise(min, Math.floor)
    const maxPaise = toPaise(max, Math.ceil)
    const ordered =
      minPaise !== null && maxPaise !== null && minPaise > maxPaise
        ? { priceMinPaise: maxPaise, priceMaxPaise: minPaise }
        : { priceMinPaise: minPaise, priceMaxPaise: maxPaise }
    router.push(
      listingUrl(
        basePath,
        { ...params, ...ordered, page: 1 },
        extraQuery,
      ) as Route,
    )
  }

  return (
    <form onSubmit={apply} className="flex items-end gap-2">
      <label className="flex-1 text-xs text-muted-foreground">
        Min {symbol}
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={min}
          onChange={(event) => setMin(event.target.value.replace(/\D/g, ""))}
          placeholder={toUnits(range.minPaise)}
          className="mt-1 h-9 w-full border border-input bg-card px-2 text-sm text-foreground"
        />
      </label>
      <label className="flex-1 text-xs text-muted-foreground">
        Max {symbol}
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={max}
          onChange={(event) => setMax(event.target.value.replace(/\D/g, ""))}
          placeholder={toUnits(range.maxPaise)}
          className="mt-1 h-9 w-full border border-input bg-card px-2 text-sm text-foreground"
        />
      </label>
      <Button type="submit" variant="outline" className="h-9 rounded-none">
        Go
      </Button>
    </form>
  )
}

/**
 * Phone filter drawer. It stays open while filters are toggled (each is a
 * navigation), so several can be picked; the footer shows the live count.
 */
export function MobileFilters({
  count,
  total,
  children,
}: {
  count: number
  total: number
  children: ReactNode
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" className="h-9 rounded-none lg:hidden" />
        }
      >
        <SlidersHorizontalIcon />
        Filters{count > 0 && ` (${count})`}
      </SheetTrigger>
      <SheetContent side="left" className="w-[88vw] gap-0 bg-paper p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="font-display text-2xl tracking-wide uppercase">
            Filters
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-8">{children}</div>
        <SheetFooter className="border-t bg-card">
          <SheetClose
            render={
              <Button className="h-12 w-full rounded-none text-sm font-semibold tracking-wider uppercase" />
            }
          >
            Show {total} {total === 1 ? "product" : "products"}
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

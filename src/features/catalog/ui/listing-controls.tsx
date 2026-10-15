"use client"

import { SlidersHorizontalIcon } from "lucide-react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"

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

/** Rupee range; the URL keeps whole rupees (?price=500-999). */
export function PriceFilter({
  basePath,
  params,
  range,
  extraQuery,
}: {
  basePath: string
  params: ListingParams
  extraQuery?: Record<string, string>
  range: { minPaise: number; maxPaise: number }
}) {
  const router = useRouter()
  const toRupees = (paise: number | null) =>
    paise === null ? "" : String(Math.round(paise / 100))
  const [min, setMin] = useState(toRupees(params.priceMinPaise))
  const [max, setMax] = useState(toRupees(params.priceMaxPaise))

  const apply = (event: React.FormEvent) => {
    event.preventDefault()
    const minPaise = min ? Math.max(0, Math.floor(Number(min))) * 100 : null
    const maxPaise = max ? Math.max(0, Math.ceil(Number(max))) * 100 : null
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
        Min ₹
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={min}
          onChange={(event) => setMin(event.target.value.replace(/\D/g, ""))}
          placeholder={toRupees(range.minPaise)}
          className="mt-1 h-9 w-full border border-input bg-card px-2 text-sm text-foreground"
        />
      </label>
      <label className="flex-1 text-xs text-muted-foreground">
        Max ₹
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={max}
          onChange={(event) => setMax(event.target.value.replace(/\D/g, ""))}
          placeholder={toRupees(range.maxPaise)}
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

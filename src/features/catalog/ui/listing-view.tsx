import { CheckIcon, XIcon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"

import { Breadcrumbs, type Crumb } from "@/components/breadcrumbs"
import { ProductGrid } from "@/components/product/product-card"
import { formatPaise } from "@/lib/money"
import {
  FACET_KEYS,
  EMPTY_PARAMS,
  hasFilters,
  listingUrl,
  toggleFacet,
  type FacetKey,
  type ListingParams,
} from "@/lib/listing-params"
import { cn } from "@/lib/utils"

import type { Listing } from "../storefront"
import { MobileFilters, PriceFilter, SortSelect } from "./listing-controls"

const FACET_LABELS: Record<FacetKey, string> = {
  color: "Colour",
  size: "Size",
  fit: "Fit",
  pattern: "Pattern",
  sleeve: "Sleeve",
}

type ListingViewProps = {
  title: string
  description?: string | null
  crumbs: Crumb[]
  basePath: string
  params: ListingParams
  listing: Listing
  subcategories?: { name: string; href: string }[]
  /** Search pages pass their query so filter links keep it. */
  extraQuery?: Record<string, string>
}

/**
 * A product listing whose every state is a URL: filters, sort and page are
 * plain links (rel="nofollow"), so it works without JavaScript and crawlers
 * see one canonical page per category.
 */
export function ListingView(props: ListingViewProps) {
  const { title, description, crumbs, params, listing, subcategories } = props
  const href = (next: ListingParams) => listingHref(props, next)
  const activeCount =
    FACET_KEYS.reduce((sum, key) => sum + params[key].length, 0) +
    (params.priceMinPaise !== null || params.priceMaxPaise !== null ? 1 : 0) +
    (params.available ? 1 : 0)

  const facets = <FacetPanel {...props} />

  return (
    <div className="page-container py-6">
      <Breadcrumbs items={crumbs} />
      <header className="mt-6 mb-6 flex flex-col gap-3">
        <h1 className="display-heading text-5xl sm:text-6xl">{title}</h1>
        {description && (
          <p className="max-w-2xl text-muted-foreground">{description}</p>
        )}
        {subcategories && subcategories.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-1">
            {subcategories.map((sub) => (
              <li key={sub.href}>
                <Link
                  href={sub.href as Route}
                  className="inline-block border border-ink px-3 py-1.5 text-xs font-semibold tracking-wide uppercase hover:bg-ink hover:text-paper"
                >
                  {sub.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <aside aria-label="Filters" className="hidden lg:block">
          {facets}
        </aside>
        <section aria-label="Products">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <p className="text-sm text-muted-foreground" role="status">
              {listing.total} {listing.total === 1 ? "product" : "products"}
            </p>
            <div className="flex items-center gap-2">
              <MobileFilters count={activeCount} total={listing.total}>
                {facets}
              </MobileFilters>
              <SortSelect
                basePath={props.basePath}
                params={params}
                extraQuery={props.extraQuery}
              />
            </div>
          </div>

          {activeCount > 0 && <ActiveFilters props={props} href={href} />}

          {listing.items.length > 0 ? (
            <ProductGrid products={listing.items} preloadFirst={4} />
          ) : (
            <div className="border border-dashed p-10 text-center">
              <p className="font-semibold">
                {listing.busy
                  ? "Search is busy right now. Please try again in a moment."
                  : "Nothing matches these filters."}
              </p>
              {!listing.busy && activeCount > 0 && (
                <Link
                  href={href({ ...EMPTY_PARAMS, sort: params.sort })}
                  className="mt-3 inline-block text-sm underline underline-offset-4"
                >
                  Clear all filters
                </Link>
              )}
            </div>
          )}

          {listing.pageCount > 1 && (
            <Pagination
              page={listing.page}
              pageCount={listing.pageCount}
              pageHref={(page) => href({ ...params, page })}
            />
          )}
        </section>
      </div>
    </div>
  )
}

function listingHref(props: ListingViewProps, next: ListingParams): Route {
  return listingUrl(props.basePath, next, props.extraQuery) as Route
}

function FacetPanel(props: ListingViewProps) {
  const { params, listing } = props
  const href = (next: ListingParams) => listingHref(props, next)
  return (
    <div className="divide-y">
      {FACET_KEYS.map((key) => {
        const options = listing.facets[key]
        if (options.length === 0) return null
        return (
          <fieldset key={key} className="py-4">
            <legend className="mb-3 text-sm font-semibold tracking-wider uppercase">
              {FACET_LABELS[key]}
            </legend>
            <ul
              className={cn(
                key === "size" ? "flex flex-wrap gap-2" : "space-y-1.5",
              )}
            >
              {options.map((option) => {
                const active = params[key].includes(option.value)
                const disabled = option.count === 0 && !active
                const label = (
                  <>
                    {key === "color" && (
                      <span
                        aria-hidden
                        className="size-4 shrink-0 rounded-full border border-ink/20"
                        style={{ backgroundColor: option.hex ?? "transparent" }}
                      />
                    )}
                    {key !== "size" && (
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center border border-ink",
                          active && "bg-ink text-paper",
                          key === "color" && "hidden",
                        )}
                      >
                        {active && <CheckIcon className="size-3" />}
                      </span>
                    )}
                    <span>{option.label}</span>
                    {key !== "size" && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {option.count}
                      </span>
                    )}
                    {active && <span className="sr-only"> (selected)</span>}
                  </>
                )
                const className = cn(
                  key === "size"
                    ? "inline-flex h-9 min-w-10 items-center justify-center border px-2 text-sm"
                    : "flex items-center gap-2 py-0.5 text-sm",
                  key === "size" && active && "border-ink bg-ink text-paper",
                  key === "size" &&
                    !active &&
                    "border-input bg-card hover:border-ink",
                  key === "color" && active && "font-semibold underline",
                  disabled && "pointer-events-none opacity-40",
                )
                return (
                  <li key={option.value}>
                    {disabled ? (
                      <span className={className} aria-disabled>
                        {label}
                      </span>
                    ) : (
                      <Link
                        href={href(toggleFacet(params, key, option.value))}
                        rel="nofollow"
                        scroll={false}
                        className={className}
                      >
                        {label}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </fieldset>
        )
      })}
      {listing.priceRange && (
        <fieldset className="py-4">
          <legend className="mb-1 text-sm font-semibold tracking-wider uppercase">
            Price
          </legend>
          <p className="mb-3 text-xs text-muted-foreground">
            {formatPaise(listing.priceRange.minPaise)} –{" "}
            {formatPaise(listing.priceRange.maxPaise)}
          </p>
          <PriceFilter
            basePath={props.basePath}
            extraQuery={props.extraQuery}
            params={params}
            range={listing.priceRange}
          />
        </fieldset>
      )}
      <div className="py-4">
        <Link
          href={href({ ...params, available: !params.available, page: 1 })}
          rel="nofollow"
          scroll={false}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <span
            aria-hidden
            className={cn(
              "flex size-4 items-center justify-center border border-ink",
              params.available && "bg-ink text-paper",
            )}
          >
            {params.available && <CheckIcon className="size-3" />}
          </span>
          In stock only
          {params.available && <span className="sr-only"> (selected)</span>}
        </Link>
      </div>
    </div>
  )
}

function ActiveFilters({
  props,
  href,
}: {
  props: ListingViewProps
  href: (next: ListingParams) => Route
}) {
  const { params, listing } = props
  const chips: { label: string; next: ListingParams }[] = []
  for (const key of FACET_KEYS) {
    for (const value of params[key]) {
      const label =
        listing.facets[key].find((option) => option.value === value)?.label ??
        value
      chips.push({ label, next: toggleFacet(params, key, value) })
    }
  }
  if (params.priceMinPaise !== null || params.priceMaxPaise !== null) {
    const min =
      params.priceMinPaise === null ? "₹0" : formatPaise(params.priceMinPaise)
    const max =
      params.priceMaxPaise === null
        ? "+"
        : `– ${formatPaise(params.priceMaxPaise)}`
    chips.push({
      label: `${min} ${max}`,
      next: { ...params, priceMinPaise: null, priceMaxPaise: null, page: 1 },
    })
  }
  if (params.available) {
    chips.push({
      label: "In stock",
      next: { ...params, available: false, page: 1 },
    })
  }
  return (
    <ul
      className="mb-5 flex flex-wrap items-center gap-2"
      aria-label="Active filters"
    >
      {chips.map((chip) => (
        <li key={chip.label}>
          <Link
            href={href(chip.next)}
            rel="nofollow"
            scroll={false}
            className="inline-flex items-center gap-1 bg-ink px-2.5 py-1 text-xs font-medium text-paper"
          >
            {chip.label}
            <XIcon className="size-3" aria-hidden />
            <span className="sr-only">Remove filter</span>
          </Link>
        </li>
      ))}
      {hasFilters(params) && (
        <li>
          <Link
            href={href({ ...EMPTY_PARAMS, sort: params.sort })}
            rel="nofollow"
            className="text-xs font-medium underline underline-offset-4"
          >
            Clear all
          </Link>
        </li>
      )}
    </ul>
  )
}

function Pagination({
  page,
  pageCount,
  pageHref,
}: {
  page: number
  pageCount: number
  pageHref: (page: number) => Route
}) {
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b)
  const cell =
    "inline-flex h-10 min-w-10 items-center justify-center border px-3 text-sm"
  return (
    <nav aria-label="Pagination" className="mt-12 flex justify-center">
      <ul className="flex flex-wrap items-center gap-1.5">
        {page > 1 && (
          <li>
            <Link
              href={pageHref(page - 1)}
              className={cn(cell, "hover:border-ink")}
            >
              Previous
            </Link>
          </li>
        )}
        {pages.map((value, index) => (
          <li key={value} className="flex items-center gap-1.5">
            {index > 0 && value - pages[index - 1]! > 1 && (
              <span aria-hidden className="px-1">
                …
              </span>
            )}
            <Link
              href={pageHref(value)}
              aria-current={value === page ? "page" : undefined}
              className={cn(
                cell,
                value === page
                  ? "border-ink bg-ink text-paper"
                  : "hover:border-ink",
              )}
            >
              <span className="sr-only">Page </span>
              {value}
            </Link>
          </li>
        ))}
        {page < pageCount && (
          <li>
            <Link
              href={pageHref(page + 1)}
              className={cn(cell, "hover:border-ink")}
            >
              Next
            </Link>
          </li>
        )}
      </ul>
    </nav>
  )
}

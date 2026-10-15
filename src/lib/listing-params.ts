import { SLUG } from "./slug"

/**
 * Listing filters live in the URL so every result page is shareable and
 * crawlable: ?color=black,blue&size=m&fit=oversized&price=0-999&available=1
 * &sort=price_asc&page=2. Parsing is lenient (bad values are dropped) and
 * serialising is canonical (sorted, defaults omitted) so equal filters always
 * produce the same URL and the same cache key.
 */

export const SORTS = [
  "featured",
  "newest",
  "price_asc",
  "price_desc",
  "discount",
] as const
export type Sort = (typeof SORTS)[number]

export const FACET_KEYS = ["color", "size", "fit", "pattern", "sleeve"] as const
export type FacetKey = (typeof FACET_KEYS)[number]

export const PAGE_SIZE = 24
const MAX_PAGE = 500

export type ListingParams = {
  color: string[]
  size: string[]
  fit: string[]
  pattern: string[]
  sleeve: string[]
  priceMinPaise: number | null
  priceMaxPaise: number | null
  available: boolean
  sort: Sort
  page: number
}

export const EMPTY_PARAMS: ListingParams = {
  color: [],
  size: [],
  fit: [],
  pattern: [],
  sleeve: [],
  priceMinPaise: null,
  priceMaxPaise: null,
  available: false,
  sort: "featured",
  page: 1,
}

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function slugList(value: string | string[] | undefined): string[] {
  const raw = (
    Array.isArray(value) ? value.join(",") : (value ?? "")
  ).toLowerCase()
  return [...new Set(raw.split(",").map((part) => part.trim()))]
    .filter((part) => SLUG.test(part))
    .sort()
    .slice(0, 20)
}

export function parseListingParams(raw: RawParams): ListingParams {
  const params: ListingParams = { ...EMPTY_PARAMS }
  for (const key of FACET_KEYS) params[key] = slugList(raw[key])

  const price = first(raw.price)?.match(/^(\d{0,7})-(\d{0,7})$/)
  if (price) {
    const min = price[1] ? Number(price[1]) * 100 : null
    const max = price[2] ? Number(price[2]) * 100 : null
    if (min === null || max === null || min <= max) {
      params.priceMinPaise = min
      params.priceMaxPaise = max
    }
  }

  params.available = first(raw.available) === "1"
  const sort = first(raw.sort)
  params.sort = SORTS.includes(sort as Sort) ? (sort as Sort) : "featured"

  const page = Number(first(raw.page))
  params.page =
    Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1
  return params
}

export function serializeListingParams(params: ListingParams): string {
  const search = new URLSearchParams()
  for (const key of FACET_KEYS) {
    if (params[key].length > 0)
      search.set(key, [...params[key]].sort().join(","))
  }
  if (params.priceMinPaise !== null || params.priceMaxPaise !== null) {
    const min =
      params.priceMinPaise === null ? "" : String(params.priceMinPaise / 100)
    const max =
      params.priceMaxPaise === null ? "" : String(params.priceMaxPaise / 100)
    search.set("price", `${min}-${max}`)
  }
  if (params.available) search.set("available", "1")
  if (params.sort !== "featured") search.set("sort", params.sort)
  if (params.page > 1) search.set("page", String(params.page))
  const query = search.toString()
  return query ? `?${query.replace(/%2C/g, ",")}` : ""
}

/** True when anything narrows the result set (used for noindex). */
export function hasFilters(params: ListingParams): boolean {
  return (
    FACET_KEYS.some((key) => params[key].length > 0) ||
    params.priceMinPaise !== null ||
    params.priceMaxPaise !== null ||
    params.available
  )
}

/** Toggles one facet value and resets to page 1. */
export function toggleFacet(
  params: ListingParams,
  key: FacetKey,
  value: string,
): ListingParams {
  const values = params[key].includes(value)
    ? params[key].filter((item) => item !== value)
    : [...params[key], value].sort()
  return { ...params, [key]: values, page: 1 }
}

/** Listing URL with extra, non-filter parameters (e.g. the search query). */
export function listingUrl(
  basePath: string,
  params: ListingParams,
  extra?: Record<string, string>,
): string {
  const query = serializeListingParams(params)
  const rest = new URLSearchParams(extra).toString()
  if (!rest) return `${basePath}${query}`
  return `${basePath}${query ? `${query}&` : "?"}${rest}`
}

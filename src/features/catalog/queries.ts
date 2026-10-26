import "server-only"
import { cacheLife, cacheTag } from "next/cache"

import type { ListingParams } from "@/lib/listing-params"
import { cacheTags } from "@/server/cache/tags"

import { searchListing, searchSuggestions } from "./search/query"
import {
  loadCatalogTree,
  loadFacetValues,
  loadListing,
  loadProductCards,
  loadProductDetail,
  loadProductSitemap,
  loadRelatedProductIds,
  type ListingScope,
} from "./storefront"

/**
 * Cached storefront reads for Server Components and GET route handlers. Per
 * ADR-016, callers reach them only after a request-time API (for example
 * `await connection()`), never during the build. Catalogue and inventory
 * mutations revalidate these tags (doc/02 §5); `cacheLife` bounds anything a
 * tag does not cover.
 */

export async function getCatalogTree() {
  "use cache"
  cacheTag(cacheTags.categoriesTree)
  cacheLife("hours")
  return loadCatalogTree()
}

/** Search results are not cached: every query would be its own entry. */
export async function getListing(
  scope: Exclude<ListingScope, { kind: "search" }>,
  params: ListingParams,
) {
  "use cache"
  cacheTag(cacheTags.productsList, cacheTags.categoriesTree)
  if (scope.kind === "collection") {
    cacheTag(cacheTags.collection(scope.collectionId))
  }
  cacheLife("hours")
  return loadListing(scope, params)
}

export async function getProductCards(ids: string[]) {
  "use cache"
  cacheTag(cacheTags.productsList)
  cacheLife("hours")
  return loadProductCards(ids)
}

export async function getProductDetail(slug: string) {
  "use cache"
  cacheLife("hours")
  const detail = await loadProductDetail(slug)
  // A slug that is not live yet may be published later, and publishing
  // revalidates the list tag.
  cacheTag(detail ? cacheTags.product(detail.id) : cacheTags.productsList)
  return detail
}

export async function getRelatedProducts(productId: string) {
  "use cache"
  cacheTag(cacheTags.productsList)
  cacheLife("hours")
  return loadProductCards(await loadRelatedProductIds(productId))
}

/** Header autocomplete; the caller normalises `query` to keep keys few. */
export async function getSuggestions(query: string) {
  "use cache"
  cacheTag(cacheTags.productsList, cacheTags.categoriesTree)
  cacheLife("minutes")
  return searchSuggestions(query, await getCatalogTree())
}

/** The filters' labels, swatches and colour families. */
export async function getFacetValues() {
  "use cache"
  cacheTag(cacheTags.productsList)
  cacheLife("hours")
  return loadFacetValues()
}

/**
 * /search results: Elasticsearch, or Postgres when it's unavailable
 * (ADR-0033). Not cached: every query would be its own entry, and
 * Elasticsearch answers without touching Postgres.
 */
export async function searchCatalog(query: string, params: ListingParams) {
  return searchListing(query, params, await getFacetValues())
}

export async function getProductSitemap() {
  "use cache"
  cacheTag(cacheTags.productsList)
  cacheLife("hours")
  return loadProductSitemap()
}

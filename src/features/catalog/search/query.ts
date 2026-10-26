import "server-only"
import type { estypes } from "@elastic/elasticsearch"

import {
  FACET_KEYS,
  PAGE_SIZE,
  type FacetKey,
  type ListingParams,
} from "@/lib/listing-params"

import {
  loadListing,
  loadSuggestions,
  shapeFacets,
  suggestCategories,
  suggestedProduct,
  valueIds,
  type CatalogTree,
  type FacetCounts,
  type FacetValue,
  type Listing,
  type ProductCard,
  type Suggestions,
} from "../storefront"
import {
  getSearchClient,
  liveSearchClient,
  searchFailed,
  searchIndexAlias,
  searchSucceeded,
} from "./client"

/**
 * Storefront search on Elasticsearch (ADR-0033), with the Postgres search as
 * the fallback whenever Elasticsearch isn't configured or fails. Results come
 * back with their product cards, so a search page reads nothing from Postgres.
 */

// While Elasticsearch is unavailable, each web process runs at most this
// many Postgres searches at once; the rest are told to try again. A search
// outage must not become a database outage.
const FALLBACK_CONCURRENCY = 4
let fallbacksRunning = 0

async function fallback<T>(run: () => Promise<T>, busy: () => T): Promise<T> {
  // Without Elasticsearch configured, Postgres is the search engine.
  if (!getSearchClient()) return run()
  if (fallbacksRunning >= FALLBACK_CONCURRENCY) return busy()
  fallbacksRunning += 1
  try {
    return await run()
  } finally {
    fallbacksRunning -= 1
  }
}

// Elasticsearch pages no deeper than this by default.
const MAX_RESULT_WINDOW = 10_000
// A typo is allowed in words of 4+ letters, two in words of 7+.
const FUZZINESS = "AUTO:4,7"

type Query = estypes.QueryDslQueryContainer

/** Every word must match (allowing typos); title matches rank first. */
function textQuery(query: string, available: boolean): Query {
  return {
    bool: {
      must: [
        {
          match: {
            all_text: {
              query,
              operator: "and",
              fuzziness: FUZZINESS,
              prefix_length: 1,
            },
          },
        },
      ],
      should: [
        { match_phrase: { title: { query, boost: 5 } } },
        { match: { title: { query, boost: 3 } } },
        { match: { keywords: { query, boost: 1.5 } } },
      ],
      filter: available ? [{ term: { in_stock: true } }] : [],
    },
  }
}

function facetField(key: FacetKey) {
  // Sizes filter on what is in stock now; everything else on what exists.
  return key === "size" ? "in_stock_value_ids" : "filter_value_ids"
}

/** The same filters as the Postgres listing, optionally leaving one out. */
function filters(
  params: ListingParams,
  values: FacetValue[],
  except?: FacetKey | "price",
): Query[] {
  const result: Query[] = []
  for (const key of FACET_KEYS) {
    if (key === except || params[key].length === 0) continue
    const ids = valueIds(values, key, params[key])
    result.push(
      ids.length > 0
        ? { terms: { [facetField(key)]: ids } }
        : { match_none: {} },
    )
  }
  if (
    except !== "price" &&
    (params.priceMinPaise !== null || params.priceMaxPaise !== null)
  ) {
    result.push({
      range: {
        min_price_paise: {
          gte: params.priceMinPaise ?? undefined,
          lte: params.priceMaxPaise ?? undefined,
        },
      },
    })
  }
  return result
}

function sortFor(params: ListingParams): estypes.Sort {
  switch (params.sort) {
    case "newest":
      return [{ published_at: "desc" }, { id: "asc" }]
    case "price_asc":
      return [{ min_price_paise: "asc" }, { id: "asc" }]
    case "price_desc":
      return [{ min_price_paise: "desc" }, { id: "asc" }]
    case "discount":
      return [
        { max_discount_percent: "desc" },
        { min_price_paise: "asc" },
        { id: "asc" },
      ]
    default:
      return [{ _score: { order: "desc" } }, { id: "asc" }]
  }
}

type Bucket = { key: string; doc_count: number }
type Aggregations = Record<FacetKey, { values: { buckets: Bucket[] } }> & {
  price: { min: { value: number | null }; max: { value: number | null } }
}

async function searchElastic(
  query: string,
  params: ListingParams,
  values: FacetValue[],
): Promise<Listing | null> {
  const client = liveSearchClient()
  if (!client) return null
  const from = (params.page - 1) * PAGE_SIZE
  const aggs: Record<string, estypes.AggregationsAggregationContainer> = {
    price: {
      filter: { bool: { filter: filters(params, values, "price") } },
      aggs: {
        min: { min: { field: "min_price_paise" } },
        max: { max: { field: "max_price_paise" } },
      },
    },
  }
  for (const key of FACET_KEYS) {
    aggs[key] = {
      filter: { bool: { filter: filters(params, values, key) } },
      aggs: { values: { terms: { field: facetField(key), size: 1_000 } } },
    }
  }
  try {
    const result = await client.search<{ card: ProductCard }, Aggregations>({
      index: searchIndexAlias(),
      query: textQuery(query, params.available),
      post_filter: { bool: { filter: filters(params, values) } },
      sort: sortFor(params),
      from: Math.min(from, MAX_RESULT_WINDOW - PAGE_SIZE),
      size: from + PAGE_SIZE > MAX_RESULT_WINDOW ? 0 : PAGE_SIZE,
      track_total_hits: true,
      _source: ["card"],
      aggs,
    })
    const total =
      typeof result.hits.total === "number"
        ? result.hits.total
        : (result.hits.total?.value ?? 0)
    const found = result.aggregations!
    const counts = {} as FacetCounts
    for (const key of FACET_KEYS) {
      counts[key] = new Map(
        found[key].values.buckets.map((b) => [b.key, b.doc_count]),
      )
    }
    searchSucceeded()
    const min = found.price.min.value
    const max = found.price.max.value
    return {
      items: result.hits.hits.flatMap((hit) =>
        hit._source ? [hit._source.card] : [],
      ),
      total,
      page: params.page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      facets: shapeFacets(counts, params, values),
      priceRange:
        min !== null && max !== null
          ? { minPaise: Math.round(min), maxPaise: Math.round(max) }
          : null,
    }
  } catch (err) {
    searchFailed(err)
    return null
  }
}

/** Search results for the /search page. */
export async function searchListing(
  query: string,
  params: ListingParams,
  values: FacetValue[],
): Promise<Listing> {
  return (
    (await searchElastic(query, params, values)) ??
    fallback(
      () => loadListing({ kind: "search", query }, params),
      () => ({
        items: [],
        total: 0,
        page: params.page,
        pageCount: 1,
        facets: shapeFacets(
          Object.fromEntries(
            FACET_KEYS.map((k) => [k, new Map()]),
          ) as FacetCounts,
          params,
          values,
        ),
        priceRange: null,
        busy: true,
      }),
    )
  )
}

/** The search box: products whose words start with what was typed. */
export async function searchSuggestions(
  query: string,
  tree: CatalogTree,
): Promise<Suggestions> {
  const client = liveSearchClient()
  const postgres = () =>
    fallback(
      () => loadSuggestions(query, tree),
      (): Suggestions => ({
        products: [],
        categories: suggestCategories(query, tree),
      }),
    )
  if (!client) return postgres()
  let cards: ProductCard[]
  try {
    const result = await client.search<{ card: ProductCard }>({
      index: searchIndexAlias(),
      size: 6,
      _source: ["card"],
      query: {
        bool: {
          should: [
            {
              multi_match: {
                query,
                type: "bool_prefix",
                operator: "and",
                fields: [
                  "title.prefix",
                  "title.prefix._2gram",
                  "title.prefix._3gram",
                ],
                boost: 2,
              },
            },
            {
              match_bool_prefix: {
                all_text: {
                  query,
                  operator: "and",
                  fuzziness: FUZZINESS,
                  prefix_length: 1,
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      },
      sort: [{ _score: { order: "desc" } }, { id: "asc" }],
    })
    searchSucceeded()
    cards = result.hits.hits.flatMap((hit) =>
      hit._source ? [hit._source.card] : [],
    )
  } catch (err) {
    searchFailed(err)
    return postgres()
  }
  return {
    products: cards.map(suggestedProduct),
    categories: suggestCategories(query, tree),
  }
}

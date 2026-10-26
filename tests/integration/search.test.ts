import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  archiveProduct,
  closeSearchClient,
  drainSearchQueue,
  getSearchClient,
  loadCatalogTree,
  loadFacetValues,
  loadListing,
  rebuildSearchIndex,
  reconcileSearchIndex,
  searchIndexAlias,
  searchListing,
  searchSuggestions,
} from "@/features/catalog"
import { adjustStock } from "@/features/inventory"
import { EMPTY_PARAMS, type ListingParams } from "@/lib/listing-params"
import { getDb } from "@/server/db/client"

import { asSystem } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { sellableProduct } from "../helpers/shop"

/**
 * Product search on Elasticsearch (ADR-0033), against the tests' own index.
 * Products get made-up title words so other files' fixtures never match.
 */

closeConnectionsAfterAll()

const word = () =>
  Array.from({ length: 9 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("")

const params = (overrides: Partial<ListingParams> = {}): ListingParams => ({
  ...EMPTY_PARAMS,
  ...overrides,
})

async function titled(title: string, stockEach = 5) {
  const product = await sellableProduct(stockEach)
  await getDb().execute(
    sql`update products set title = ${title} where id = ${product.productId}`,
  )
  return product
}

/** Index what's queued and make it searchable now (not in a second). */
async function sync() {
  await drainSearchQueue()
  await getSearchClient()!.indices.refresh({ index: searchIndexAlias() })
}

const ids = (listing: { items: { id: string }[] }) =>
  listing.items.map((item) => item.id).toSorted()

beforeAll(async () => {
  expect(getSearchClient()).not.toBeNull()
  await rebuildSearchIndex()
})

/**
 * As the page does: filter labels loaded at search time. Closes the
 * fallback breaker first, so every assertion is about Elasticsearch.
 */
const searchFor = async (query: string, listing: ListingParams) => {
  ;(globalThis as { __duisSearchDownUntil?: number }).__duisSearchDownUntil = 0
  return searchListing(query, listing, await loadFacetValues())
}

afterAll(async () => {
  await closeSearchClient()
})

describe("finding products", () => {
  it("allows typos, customers' words for things, and any word order", async () => {
    const name = word()
    const tee = await titled(`${name} Oversized T-Shirt`)
    const hoodie = await titled(`${name} Heavyweight Hoodie`)
    await sync()

    const find = async (query: string) => ids(await searchFor(query, params()))
    expect(await find(name)).toEqual(
      [tee.productId, hoodie.productId].toSorted(),
    )
    // One typo in the made-up word, one in "hoodie".
    const typo = `${name.slice(0, 4)}${name[5]}${name[4]}${name.slice(6)}`
    expect(await find(`${typo} hoddie`)).toEqual([hoodie.productId])
    // Both are in the fixture's "T-Shirts" category and neither says "tee":
    // "tee" and "t shirt" mean T-shirt, in any word order.
    const both = [tee.productId, hoodie.productId].toSorted()
    expect(await find(`tee ${name}`)).toEqual(both)
    expect(await find(`${name} t shirt`)).toEqual(both)
  })

  it("suggests products from the first letters typed", async () => {
    const name = word()
    await titled(`${name} Crewneck Sweatshirt`)
    await sync()
    const suggestions = await searchSuggestions(
      name.slice(0, 5),
      await loadCatalogTree(),
    )
    expect(suggestions.products.map((p) => p.title)).toEqual([
      `${name} Crewneck Sweatshirt`,
    ])
  })
})

describe("matches the Postgres listing", () => {
  it("has the same products, filter counts and price range", async () => {
    const name = word()
    await titled(`${name} Washed Tee`)
    await titled(`${name} Boxy Tee`)
    await sync()

    for (const filters of [
      {},
      { color: ["black"] },
      { size: ["m"], sort: "price_asc" as const },
      { priceMinPaise: 1_000, priceMaxPaise: 80_000 },
    ]) {
      const elastic = await searchFor(name, params(filters))
      const postgres = await loadListing(
        { kind: "search", query: name },
        params(filters),
      )
      expect(ids(elastic)).toEqual(ids(postgres))
      expect(elastic.total).toBe(postgres.total)
      expect(elastic.facets).toEqual(postgres.facets)
      expect(elastic.priceRange).toEqual(postgres.priceRange)
      // The card is the one the rest of the shop shows.
      expect(
        elastic.items.toSorted((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(postgres.items.toSorted((a, b) => a.id.localeCompare(b.id)))
    }
  })
})

describe("follows changes in Postgres", () => {
  it("indexes renames, sell-outs and archiving", async () => {
    const name = word()
    const product = await titled(`${name} Polo`, 1)
    await sync()
    const search = (query: string, overrides: Partial<ListingParams> = {}) =>
      searchFor(query, params(overrides))

    const renamed = word()
    await getDb().execute(
      sql`update products set title = ${`${renamed} Polo`} where id = ${product.productId}`,
    )
    await sync()
    expect(ids(await search(renamed))).toEqual([product.productId])
    expect(ids(await search(name))).toEqual([])

    // Sell every variant out: the card says so and "in stock only" hides it.
    const { rows } = await getDb().execute<{ id: string }>(sql`
      select id from product_variants where product_id = ${product.productId}`)
    for (const { id } of rows) {
      await adjustStock(asSystem(), {
        variantId: id,
        delta: -1,
        reason: "damaged",
      })
    }
    await sync()
    expect((await search(renamed)).items[0]?.inStock).toBe(false)
    expect(ids(await search(renamed, { available: true }))).toEqual([])

    await archiveProduct(asSystem(), { id: product.productId })
    await sync()
    expect(ids(await search(renamed))).toEqual([])
  })

  it("repairs a document lost from the index", async () => {
    const name = word()
    const product = await titled(`${name} Shirt`)
    await sync()
    await getSearchClient()!.delete({
      index: searchIndexAlias(),
      id: product.productId,
      refresh: true,
    })
    expect(ids(await searchFor(name, params()))).toEqual([])

    expect(await reconcileSearchIndex()).toBeGreaterThanOrEqual(1)
    await sync()
    expect(ids(await searchFor(name, params()))).toEqual([product.productId])
  })
})

type SearchGlobals = {
  __duisSearch?: unknown
  __duisSearchDownUntil?: number
  __duisSearchTimeouts?: number
}
const searchGlobals = globalThis as SearchGlobals

/** Runs with the storefront's client swapped, then puts everything back. */
async function withSearchClient(
  node: string,
  run: () => Promise<void>,
): Promise<void> {
  const saved = searchGlobals.__duisSearch
  const { Client } = await import("@elastic/elasticsearch")
  searchGlobals.__duisSearch = new Client({
    node,
    requestTimeout: 300,
    maxRetries: 0,
  })
  searchGlobals.__duisSearchDownUntil = 0
  searchGlobals.__duisSearchTimeouts = 0
  try {
    await run()
  } finally {
    searchGlobals.__duisSearch = saved
    searchGlobals.__duisSearchDownUntil = 0
    searchGlobals.__duisSearchTimeouts = 0
  }
}

describe("when Elasticsearch is unavailable", () => {
  it("searches Postgres instead, and skips Elasticsearch for a while", async () => {
    const name = word()
    const product = await titled(`${name} Overshirt`)
    // Not indexed, and the client now points nowhere.
    await withSearchClient("http://localhost:1", async () => {
      const listing = await searchListing(
        name,
        params(),
        await loadFacetValues(),
      )
      expect(ids(listing)).toEqual([product.productId])
      expect(searchGlobals.__duisSearchDownUntil).toBeGreaterThan(Date.now())
    })
  })

  it("treats one slow answer as slow, not down; three in a row as down", async () => {
    // Accepts connections and never answers.
    const { createServer } = await import("node:http")
    const silent = createServer(() => {})
    await new Promise<void>((resolve) => silent.listen(0, resolve))
    const { port } = silent.address() as { port: number }
    try {
      await withSearchClient(`http://localhost:${port}`, async () => {
        const values = await loadFacetValues()
        const name = word()
        await searchListing(name, params(), values)
        // That search used Postgres, but the next still tries Elasticsearch.
        expect(searchGlobals.__duisSearchDownUntil).toBe(0)
        await searchListing(name, params(), values)
        expect(searchGlobals.__duisSearchDownUntil).toBe(0)
        await searchListing(name, params(), values)
        expect(searchGlobals.__duisSearchDownUntil).toBeGreaterThan(Date.now())
      })
    } finally {
      silent.closeAllConnections()
      silent.close()
    }
  })

  it("lets only a few searches at a time fall back to Postgres", async () => {
    const values = await loadFacetValues()
    const name = word()
    await titled(`${name} Jacket`)
    // Elasticsearch marked down: every search wants Postgres at once.
    searchGlobals.__duisSearchDownUntil = Date.now() + 30_000
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, () => searchListing(name, params(), values)),
      )
      const busy = results.filter((r) => r.busy)
      expect(results.length - busy.length).toBe(4)
      expect(busy).toHaveLength(8)
      expect(busy[0]).toMatchObject({ items: [], total: 0 })
      // Once they finish, searches run again.
      expect(ids(await searchListing(name, params(), values))).toHaveLength(1)
    } finally {
      searchGlobals.__duisSearchDownUntil = 0
    }
  })
})

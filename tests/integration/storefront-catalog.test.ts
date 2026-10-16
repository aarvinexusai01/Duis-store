import { beforeAll, describe, expect, it } from "vitest"

import { publishProduct, setProductMedia } from "@/features/catalog"
import {
  loadCatalogTree,
  loadListing,
  loadProductDetail,
  loadRelatedProductIds,
  loadSuggestions,
  resolveShopLocation,
} from "@/features/catalog/storefront"
import { adjustStock } from "@/features/inventory"
import { uploadImage } from "@/features/media"
import { EMPTY_PARAMS, parseListingParams } from "@/lib/listing-params"
import { getDb } from "@/server/db/client"
import { sql } from "drizzle-orm"

import { asSystem } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"

closeConnectionsAfterAll()

const system = asSystem()
let fx: Awaited<ReturnType<typeof createProductFixture>>
let sibling: Awaited<ReturnType<typeof createProductFixture>>
let teesPath: string
let slug: string

async function publish(fixture: typeof fx) {
  const image = await uploadImage(system, { bytes: await makeUniqueImage() })
  await setProductMedia(system, {
    productId: fixture.productId,
    items: [{ mediaId: image.id, colorValueId: fixture.black }],
  })
  await publishProduct(system, { id: fixture.productId })
}

beforeAll(async () => {
  fx = await createProductFixture()
  sibling = await createProductFixture()
  await publish(fx)
  await publish(sibling)
  // Stock: black/M only, so "size m" and "in stock" filters have something to find.
  const blackM = await getDb().execute<{ id: string }>(sql`
    select v.id from product_variants v where v.product_id = ${fx.productId} and v.option_signature = 'color=black;size=m'
  `)
  await adjustStock(system, {
    variantId: blackM.rows[0]!.id,
    delta: 4,
    reason: "receive",
  })
  const [path] = (
    await getDb().execute<{ path: string }>(
      sql`select path::text from categories where id = ${fx.teesId}`,
    )
  ).rows
  teesPath = path!.path
  slug = (
    await getDb().execute<{ slug: string }>(
      sql`select slug::text from products where id = ${fx.productId}`,
    )
  ).rows[0]!.slug
})

describe("catalogue tree", () => {
  it("builds hrefs from slugs and resolves shop paths", async () => {
    const tree = await loadCatalogTree()
    const oversized = tree.categories.find((c) => c.id === fx.oversizedId)!
    expect(oversized.href).toMatch(
      /^\/shop\/men-[a-z0-9]+\/t-shirts-[a-z0-9]+\/oversized-[a-z0-9]+$/,
    )

    const slugs = oversized.href.replace("/shop/", "").split("/")
    expect(resolveShopLocation(tree, slugs)).toMatchObject({
      kind: "category",
      category: { id: fx.oversizedId },
    })
    expect(resolveShopLocation(tree, [...slugs, "nope"])).toBeNull()
    expect(resolveShopLocation(tree, [])).toEqual({ kind: "all" })
  })
})

describe("listings", () => {
  it("lists a category subtree with facets and cards", async () => {
    const listing = await loadListing(
      { kind: "category", categoryPath: teesPath },
      EMPTY_PARAMS,
    )
    expect(listing.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([fx.productId]),
    )
    const card = listing.items.find((item) => item.id === fx.productId)!
    expect(card).toMatchObject({
      pricePaise: 79_900,
      mrpPaise: 99_900,
      discountPercent: 20,
      inStock: true,
    })
    expect(card.image?.key).toMatch(/^[a-f0-9]{32}$/)
    expect(card.colours.map((c) => c.slug)).toEqual(["black", "white"])
    expect(listing.facets.color.map((option) => option.value)).toEqual(
      expect.arrayContaining(["black", "white"]),
    )
    expect(listing.priceRange).toEqual({ minPaise: 79_900, maxPaise: 79_900 })
  })

  it("filters by in-stock size and availability", async () => {
    const scope = { kind: "category" as const, categoryPath: teesPath }
    const sizeM = await loadListing(scope, parseListingParams({ size: "m" }))
    expect(sizeM.items.map((i) => i.id)).toEqual([fx.productId])
    const sizeL = await loadListing(scope, parseListingParams({ size: "l" }))
    expect(sizeL.items).toEqual([])
    const available = await loadListing(
      scope,
      parseListingParams({ available: "1" }),
    )
    expect(available.items.map((i) => i.id)).toContain(fx.productId)
    expect(available.items.map((i) => i.id)).not.toContain(sibling.productId)
  })

  it("filters by colour family and keeps other families countable", async () => {
    const listing = await loadListing(
      { kind: "category", categoryPath: teesPath },
      parseListingParams({ color: "black" }),
    )
    expect(listing.items.map((i) => i.id)).toContain(fx.productId)
    // The colour facet ignores its own filter, so White still shows a count.
    expect(
      listing.facets.color.find((option) => option.value === "white")?.count,
    ).toBeGreaterThan(0)
  })

  it("sorts and paginates", async () => {
    const listing = await loadListing(
      { kind: "all" },
      parseListingParams({ sort: "price_asc", page: "1" }),
    )
    const prices = listing.items.map((item) => item.pricePaise)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(listing.pageCount).toBeGreaterThanOrEqual(1)
  })
})

describe("search", () => {
  it("finds products by words, typos and prefixes", async () => {
    const listing = await loadListing(
      { kind: "search", query: "midnight oversized" },
      EMPTY_PARAMS,
    )
    expect(listing.items.map((i) => i.id)).toContain(fx.productId)

    const typo = await loadListing(
      { kind: "search", query: "Midnite Oversized Tee" },
      EMPTY_PARAMS,
    )
    expect(typo.items.map((i) => i.id)).toContain(fx.productId)

    // Prefix match. Other test files create identical fixture products and
    // suggestions are capped, so check what matched rather than which one.
    const suggestions = await loadSuggestions("midn", await loadCatalogTree())
    expect(suggestions.products.length).toBeGreaterThan(0)
    expect(
      suggestions.products.every((p) => p.title.startsWith("Midnight")),
    ).toBe(true)
    expect(
      (await loadSuggestions("   ", await loadCatalogTree())).products,
    ).toEqual([])
  })
})

describe("product detail", () => {
  it("returns axes, variants, media, size chart and legal fields", async () => {
    const detail = await loadProductDetail(slug)
    expect(detail).toMatchObject({
      id: fx.productId,
      hsnCode: "6109",
      countryOfOrigin: "IN",
      netQuantity: "1 N",
    })
    expect(detail!.axes.map((axis) => axis.code)).toEqual(["color", "size"])
    expect(detail!.axes[1]!.values.map((v) => v.slug)).toEqual(["s", "m", "l"])
    expect(detail!.variants).toHaveLength(6)
    expect(
      detail!.variants.find(
        (v) => v.options.color === "black" && v.options.size === "m",
      ),
    ).toMatchObject({
      pricePaise: 79_900,
      mrpPaise: 99_900,
    })
    expect(detail!.media[0]).toMatchObject({ colorSlug: "black" })
  })

  it("hides unpublished products and suggests related ones", async () => {
    const draft = await createProductFixture()
    const draftSlug = (
      await getDb().execute<{ slug: string }>(
        sql`select slug::text from products where id = ${draft.productId}`,
      )
    ).rows[0]!.slug
    expect(await loadProductDetail(draftSlug)).toBeNull()
    expect(await loadRelatedProductIds(fx.productId)).not.toContain(
      fx.productId,
    )
  })
})

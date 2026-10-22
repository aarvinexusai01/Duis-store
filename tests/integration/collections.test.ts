import { asc, eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { collectionProducts } from "@/db/schema"
import {
  archiveProduct,
  publishProduct,
  setProductMedia,
} from "@/features/catalog"
import {
  createCollection,
  refreshAutomaticCollections,
  setCollectionProducts,
  updateCollection,
} from "@/features/collections"
import { uploadImage } from "@/features/media"
import { getDb } from "@/server/db/client"

import { asSystem, unique } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"

closeConnectionsAfterAll()

const system = asSystem()

async function publishedFixture() {
  const fx = await createProductFixture()
  const image = await uploadImage(system, { bytes: await makeUniqueImage() })
  await setProductMedia(system, {
    productId: fx.productId,
    items: [{ mediaId: image.id }],
  })
  await publishProduct(system, { id: fx.productId })
  return fx
}

async function members(collectionId: string) {
  const rows = await getDb()
    .select({ productId: collectionProducts.productId })
    .from(collectionProducts)
    .where(eq(collectionProducts.collectionId, collectionId))
    .orderBy(asc(collectionProducts.position))
  return rows.map((row) => row.productId)
}

describe("manual collections", () => {
  it("keeps products in the order editors choose", async () => {
    const [a, b] = [await createProductFixture(), await createProductFixture()]
    const { id } = await createCollection(system, {
      type: "manual",
      slug: unique("picks"),
      title: "Staff picks",
    })
    await setCollectionProducts(system, {
      collectionId: id,
      productIds: [b.productId, a.productId],
    })
    expect(await members(id)).toEqual([b.productId, a.productId])
  })

  it("refreshes pages that show the collection, the home page included", async () => {
    const product = await createProductFixture()
    const { id } = await createCollection(system, {
      type: "manual",
      slug: unique("best"),
      title: "Best Sellers",
    })
    await setCollectionProducts(system, {
      collectionId: id,
      productIds: [product.productId],
    })
    // CMS pages (the home page's "Best sellers" section) are cached under
    // the collections tag, not each collection's own one.
    const jobs = await getDb().execute<{ tags: string[] }>(sql`
      select data->'tags' as tags from pgboss.job
      where name = 'cache.revalidate' and data->'tags' ? ${`collection:${id}`}
      order by created_on desc limit 1`)
    expect(jobs.rows[0]?.tags).toEqual(
      expect.arrayContaining([`collection:${id}`, "collections:list"]),
    )
  })

  it("rejects rules on manual collections and duplicate slugs", async () => {
    const slug = unique("dup")
    const { id } = await createCollection(system, {
      type: "manual",
      slug,
      title: "One",
    })
    await expect(
      updateCollection(system, { id, rules: [{ field: "tag", tags: ["x"] }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
    await expect(
      createCollection(system, { type: "manual", slug, title: "Two" }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })
})

describe("automatic collections", () => {
  it("fills price and category-subtree rules from published products only", async () => {
    const fx = await publishedFixture()

    const underPrice = await createCollection(system, {
      type: "automatic",
      slug: unique("under-999"),
      title: "Under ₹999",
      rules: [{ field: "price", operator: "lte", valuePaise: 99_900 }],
    })
    // The rule names the parent category; the product sits in a child.
    const inTees = await createCollection(system, {
      type: "automatic",
      slug: unique("tees"),
      title: "All tees",
      rules: [{ field: "category", categoryIds: [fx.teesId] }],
    })
    expect(await members(underPrice.id)).toContain(fx.productId)
    expect(await members(inTees.id)).toContain(fx.productId)

    const draft = await createProductFixture()
    await refreshAutomaticCollections(inTees.id)
    expect(await members(inTees.id)).not.toContain(draft.productId)

    await archiveProduct(system, { id: fx.productId })
    await refreshAutomaticCollections(underPrice.id)
    expect(await members(underPrice.id)).not.toContain(fx.productId)
  })

  it("combines rules with all or any", async () => {
    const fx = await publishedFixture()
    const rules = [
      { field: "tag" as const, tags: ["streetwear"] },
      {
        field: "price" as const,
        operator: "gte" as const,
        valuePaise: 5_000_000,
      },
    ]
    const all = await createCollection(system, {
      type: "automatic",
      slug: unique("all"),
      title: "All",
      rules,
      ruleMatch: "all",
    })
    const any = await createCollection(system, {
      type: "automatic",
      slug: unique("any"),
      title: "Any",
      rules,
      ruleMatch: "any",
    })
    expect(await members(all.id)).not.toContain(fx.productId)
    expect(await members(any.id)).toContain(fx.productId)
  })
})

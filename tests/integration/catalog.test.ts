import { eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import {
  auditLogs,
  categories,
  productListingCache,
  products,
  productVariants,
} from "@/db/schema"
import {
  createCategory,
  generateVariants,
  moveCategory,
  publishProduct,
  setProductMedia,
  updateVariant,
} from "@/features/catalog"
import { adjustStock } from "@/features/inventory"
import { uploadImage } from "@/features/media"
import { getDb } from "@/server/db/client"

import { asSystem, unique } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"

closeConnectionsAfterAll()

const system = asSystem()

async function codeOf(promise: Promise<unknown>) {
  return promise.then(
    () => "no error",
    (err: { code?: string }) => err.code ?? "unknown",
  )
}

describe("category tree", () => {
  it("builds ltree paths and moves whole subtrees", async () => {
    const fx = await createProductFixture()
    const pathOf = async (id: string) =>
      (
        await getDb()
          .select({ path: categories.path })
          .from(categories)
          .where(eq(categories.id, id))
      )[0]!.path
    expect(
      (await pathOf(fx.oversizedId)).startsWith(`${await pathOf(fx.teesId)}.`),
    ).toBe(true)

    const graphic = await createCategory(system, {
      departmentId: fx.departmentId,
      parentId: fx.oversizedId,
      slug: unique("graphic"),
      name: "Graphic",
    })
    await moveCategory(system, { id: fx.oversizedId, parentId: null })

    const [moved] = await getDb()
      .select()
      .from(categories)
      .where(eq(categories.id, fx.oversizedId))
    const [child] = await getDb()
      .select()
      .from(categories)
      .where(eq(categories.id, graphic.id))
    expect(moved!.path).toBe(fx.oversizedId.replace(/-/g, ""))
    expect(child!.path.startsWith(`${moved!.path}.`)).toBe(true)
  })

  it("refuses to move a category inside itself and rejects duplicate sibling slugs", async () => {
    const fx = await createProductFixture()
    expect(
      await codeOf(
        moveCategory(system, { id: fx.teesId, parentId: fx.oversizedId }),
      ),
    ).toBe("INVALID_STATE")
    const [tees] = await getDb()
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.id, fx.teesId))
    expect(
      await codeOf(
        createCategory(system, {
          departmentId: fx.departmentId,
          slug: tees!.slug,
          name: "Again",
        }),
      ),
    ).toBe("CONFLICT")
  })
})

describe("products and variants", () => {
  it("inherits the HSN code and generates one variant per combination", async () => {
    const fx = await createProductFixture()
    const [product] = await getDb()
      .select()
      .from(products)
      .where(eq(products.id, fx.productId))
    expect(product).toMatchObject({ hsnCode: "6109", status: "draft" })
    expect(fx.variants).toHaveLength(6)

    const signatures = await getDb()
      .select({ signature: productVariants.optionSignature })
      .from(productVariants)
      .where(eq(productVariants.productId, fx.productId))
    expect(signatures.map((row) => row.signature)).toContain(
      "color=black;size=m",
    )

    // Running it again creates nothing new.
    const again = await generateVariants(system, {
      productId: fx.productId,
      axes: [
        { attributeId: fx.colorId, valueIds: [fx.black] },
        {
          attributeId: fx.sizeId,
          valueIds: (await sizeIds(fx.productId)).slice(0, 1),
        },
      ],
      pricePaise: 79_900,
      mrpPaise: 99_900,
      skuPrefix: "REPEAT",
    })
    expect(again).toEqual({ created: 0, skipped: 1 })
  })

  it("never lets the price exceed the MRP", async () => {
    const fx = await createProductFixture()
    expect(
      await codeOf(
        updateVariant(system, { id: fx.variants[0]!.id, mrpPaise: 50_000 }),
      ),
    ).toBe("VALIDATION_FAILED")
  })

  it("publishes only complete products and keeps the listing cache in step", async () => {
    const fx = await createProductFixture()
    const notReady = await publishProduct(system, { id: fx.productId }).catch(
      (err) => err,
    )
    expect(notReady).toMatchObject({
      code: "INVALID_STATE",
      details: { problems: ["Add at least one image."] },
    })

    const image = await uploadImage(system, {
      bytes: await makeUniqueImage(),
      altText: "Front",
    })
    await setProductMedia(system, {
      productId: fx.productId,
      items: [{ mediaId: image.id, colorValueId: fx.black }],
    })
    await publishProduct(system, { id: fx.productId })

    const [before] = await getDb()
      .select()
      .from(productListingCache)
      .where(eq(productListingCache.productId, fx.productId))
    expect(before).toMatchObject({
      minPricePaise: 79_900,
      maxPricePaise: 79_900,
      maxDiscountPercent: 20,
      inStock: false,
      primaryMediaId: image.id,
    })
    expect(before!.colorValueIds).toEqual(
      expect.arrayContaining([fx.black, fx.white]),
    )

    await adjustStock(system, {
      variantId: fx.variants[0]!.id,
      delta: 5,
      reason: "receive",
    })
    const [after] = await getDb()
      .select()
      .from(productListingCache)
      .where(eq(productListingCache.productId, fx.productId))
    expect(after!.inStock).toBe(true)
    expect(after!.inStockValueIds.length).toBe(2) // one colour + one size
  })

  it("finds products by title, category, colour and tag", async () => {
    const fx = await createProductFixture()
    const search = async (query: string) =>
      (
        await getDb().execute<{ id: string }>(
          sql`select id from products where search_vector @@ websearch_to_tsquery('english', ${query})`,
        )
      ).rows.map((row) => row.id)

    expect(await search("midnight tee")).toContain(fx.productId)
    expect(await search("oversized black")).toContain(fx.productId)
    expect(await search("streetwear")).toContain(fx.productId)
  })

  it("audits catalogue changes", async () => {
    const fx = await createProductFixture()
    const entries = await getDb()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, fx.productId))
    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["product.create", "product.generate_variants"]),
    )
  })
})

async function sizeIds(productId: string): Promise<string[]> {
  const rows = await getDb().execute<{ id: string }>(sql`
    select distinct vav.attribute_value_id as id
    from product_variants v
    join variant_attribute_values vav on vav.variant_id = v.id
    join attribute_values val on val.id = vav.attribute_value_id
    join attributes a on a.id = val.attribute_id
    where v.product_id = ${productId} and a.code = 'size'
  `)
  return rows.rows.map((row) => row.id)
}

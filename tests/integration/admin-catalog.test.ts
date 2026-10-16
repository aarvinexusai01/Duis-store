import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import {
  adminCatalogOptions,
  adminGetProduct,
  adminListProducts,
  duplicateProduct,
  publishProduct,
  setProductMedia,
  updateAttributeValue,
  updateSizeChart,
  createSizeChart,
} from "@/features/catalog"
import {
  adminGetCollection,
  createCollection,
  previewCollectionRules,
  refreshAutomaticCollections,
} from "@/features/collections"
import {
  adjustStock,
  adminListMovements,
  adminListStock,
  setCountedStock,
} from "@/features/inventory"
import { uploadImage } from "@/features/media"
import { operationsSummary, salesSummary } from "@/features/reports"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { isDomainError } from "@/server/errors"

import { createUserActor, unique } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"

closeConnectionsAfterAll()

let admin: Actor
let fx: Awaited<ReturnType<typeof createProductFixture>>
let variantId: string

async function audits(entityId: string, action: string) {
  const { rows } = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n from audit_logs where entity_id = ${entityId} and action = ${action}`)
  return rows[0]!.n
}

async function code(work: Promise<unknown>) {
  try {
    await work
    return "ok"
  } catch (error) {
    return isDomainError(error) ? error.code : String(error)
  }
}

beforeAll(async () => {
  admin = await createUserActor("store_admin")
  fx = await createProductFixture(admin)
  const image = await uploadImage(admin, { bytes: await makeUniqueImage() })
  await setProductMedia(admin, {
    productId: fx.productId,
    items: [{ mediaId: image.id, colorValueId: fx.black }],
  })
  await publishProduct(admin, { id: fx.productId })
  const { rows } = await getDb().execute<{ id: string }>(sql`
    select id from product_variants where product_id = ${fx.productId} order by sku limit 1`)
  variantId = rows[0]!.id
})

describe("product admin", () => {
  it("lists with search and status filters and loads a full product", async () => {
    const product = await adminGetProduct(admin, { id: fx.productId })
    const bySku = await adminListProducts(admin, {
      q: product.variants[0]!.sku,
      page: 1,
    })
    expect(bySku.rows.map((r) => r.id)).toContain(fx.productId)
    const drafts = await adminListProducts(admin, { status: "draft", page: 1 })
    expect(drafts.rows.map((r) => r.id)).not.toContain(fx.productId)
    expect(product).toMatchObject({
      status: "active",
      axisAttributeIds: [expect.any(String), expect.any(String)],
    })
    expect(product.variants).toHaveLength(6)
    expect(product.media[0]!.colorValueId).toBe(fx.black)
  })

  it("duplicates a product as a draft with its categories, options and photos", async () => {
    const slug = unique("copy")
    const { id } = await duplicateProduct(admin, { id: fx.productId, slug })
    const copy = await adminGetProduct(admin, { id })
    expect(copy).toMatchObject({ status: "draft", slug, variants: [] })
    expect(copy.categoryIds).toEqual(
      (await adminGetProduct(admin, { id: fx.productId })).categoryIds,
    )
    expect(copy.media).toHaveLength(1)
    expect(await audits(id, "product.duplicate")).toBe(1)
    expect(
      await code(duplicateProduct(admin, { id: fx.productId, slug })),
    ).toBe("CONFLICT")
  })

  it("edits attribute values and size charts with an audit entry", async () => {
    await updateAttributeValue(admin, {
      id: fx.black,
      label: "Jet Black",
      swatchHex: "#0a0a0a",
    })
    const options = await adminCatalogOptions(admin, {})
    const black = options.attributes
      .flatMap((a) => a.values)
      .find((v) => v.id === fx.black)!
    expect(black).toMatchObject({ label: "Jet Black", swatchHex: "#0a0a0a" })
    expect(await audits(fx.black, "attribute_value.update")).toBe(1)
    await updateAttributeValue(admin, {
      id: fx.black,
      label: "Black",
      swatchHex: "#111111",
    })

    const chart = await createSizeChart(admin, {
      name: unique("Tees"),
      unit: "in",
      chart: { columns: ["Chest"], rows: [{ size: "M", values: ["40"] }] },
    })
    await updateSizeChart(admin, {
      id: chart.id,
      name: "Tees v2",
      unit: "cm",
      chart: { columns: ["Chest"], rows: [{ size: "M", values: ["102"] }] },
    })
    expect(await audits(chart.id, "size_chart.update")).toBe(1)
    expect(
      await code(
        updateSizeChart(admin, {
          id: chart.id,
          name: "Bad",
          unit: "cm",
          chart: { columns: ["A", "B"], rows: [{ size: "M", values: ["1"] }] },
        }),
      ),
    ).toBe("VALIDATION_FAILED")
  })
})

describe("stock admin", () => {
  it("counts stock exactly, never below what is reserved, and records it", async () => {
    await adjustStock(admin, { variantId, delta: 10, reason: "receive" })
    const { delta } = await setCountedStock(admin, {
      variantId,
      counted: 7,
      note: "shelf count",
    })
    expect(delta).toBe(-3)
    const stock = await adminListStock(admin, {
      q: (await adminGetProduct(admin, { id: fx.productId })).variants.find(
        (v) => v.id === variantId,
      )!.sku,
      lowOnly: false,
      page: 1,
    })
    expect(stock.rows[0]).toMatchObject({ onHand: 7, available: 7 })
    const moves = await adminListMovements(admin, { variantId, page: 1 })
    expect(moves.rows[0]).toMatchObject({
      delta: -3,
      reason: "count_correction",
      note: "shelf count",
    })
    expect(await audits(variantId, "inventory.count")).toBe(1)

    await getDb().execute(
      sql`update inventory_levels set reserved = 5 where variant_id = ${variantId}`,
    )
    expect(await code(setCountedStock(admin, { variantId, counted: 4 }))).toBe(
      "CONFLICT",
    )
    await getDb().execute(
      sql`update inventory_levels set reserved = 0 where variant_id = ${variantId}`,
    )
  })
})

describe("collection admin", () => {
  it("previews rule matches exactly as the refresh job builds them", async () => {
    const rules = [{ field: "category" as const, categoryIds: [fx.teesId] }]
    const preview = await previewCollectionRules(admin, {
      rules,
      ruleMatch: "all",
    })
    const created = await createCollection(admin, {
      type: "automatic",
      slug: unique("tees"),
      title: "Tees",
      rules,
      ruleMatch: "all",
    })
    await refreshAutomaticCollections(created.id)
    const collection = await adminGetCollection(admin, { id: created.id })
    expect(collection.products.length).toBe(preview.count)
    expect(preview.count).toBeGreaterThanOrEqual(1)
  })
})

describe("dashboard", () => {
  it("hides money from roles without financial access", async () => {
    const fulfilment = await createUserActor("fulfilment_staff")
    const ops = await operationsSummary(fulfilment, {})
    expect(ops.recent.every((r) => r.totalPaise === null)).toBe(true)
    expect(await code(salesSummary(fulfilment, { days: 30 }))).toBe("FORBIDDEN")
    const sales = await salesSummary(admin, { days: 7 })
    expect(sales.daily).toHaveLength(7)
  })
})

describe("content editor", () => {
  it("is refused every catalogue and stock change, called directly", async () => {
    const editor = await createUserActor("content_editor")
    for (const work of [
      duplicateProduct(editor, { id: fx.productId, slug: unique("x") }),
      updateAttributeValue(editor, { id: fx.black, label: "x" }),
      setCountedStock(editor, { variantId, counted: 1 }),
      adjustStock(editor, { variantId, delta: 1, reason: "receive" }),
      publishProduct(editor, { id: fx.productId }),
    ]) {
      expect(await code(work)).toBe("FORBIDDEN")
    }
  })
})

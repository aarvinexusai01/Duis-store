import { and, eq } from "drizzle-orm"

import {
  attributes,
  attributeValues,
  productVariants,
  stockLocations,
} from "@/db/schema"
import {
  createAttribute,
  createAttributeValue,
  createCategory,
  createDepartment,
  createProduct,
  generateVariants,
} from "@/features/catalog"
import { createStockLocation } from "@/features/inventory"
import { paragraphs } from "@/lib/rich-text"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { asSystem, unique } from "./actors"

/** Find-or-create, because attribute codes and the default location are global. */
export async function ensureAttribute(
  code: string,
  name: string,
  isVariantAxis = true,
) {
  const [found] = await getDb()
    .select({ id: attributes.id })
    .from(attributes)
    .where(eq(attributes.code, code))
  if (found) return found.id
  return (
    await createAttribute(asSystem(), {
      code,
      name,
      isVariantAxis,
      kind: code === "color" ? "swatch" : "text",
    })
  ).id
}

export async function ensureValue(
  attributeId: string,
  slug: string,
  label: string,
  swatchHex?: string,
) {
  const [found] = await getDb()
    .select({ id: attributeValues.id })
    .from(attributeValues)
    .where(
      and(
        eq(attributeValues.attributeId, attributeId),
        eq(attributeValues.slug, slug),
      ),
    )
  if (found) return found.id
  return (
    await createAttributeValue(asSystem(), {
      attributeId,
      slug,
      label,
      swatchHex,
    })
  ).id
}

export async function ensureDefaultLocation() {
  const [found] = await getDb()
    .select({ id: stockLocations.id })
    .from(stockLocations)
    .where(eq(stockLocations.isDefault, true))
  if (found) return found.id
  return (
    await createStockLocation(asSystem(), {
      code: "test-warehouse",
      name: "Test warehouse",
      addressLine1: "1 Test Street, Andheri East",
      city: "Mumbai",
      stateCode: "IN-MH",
      postalCode: "400069",
      isDefault: true,
    })
  ).id
}

/** Department → T-Shirts → Oversized, with a 2 colour × 3 size product. */
export async function createProductFixture(actor: Actor = asSystem()) {
  await ensureDefaultLocation()
  const colorId = await ensureAttribute("color", "Colour")
  const sizeId = await ensureAttribute("size", "Size")
  const black = await ensureValue(colorId, "black", "Black", "#111111")
  const white = await ensureValue(colorId, "white", "White", "#ffffff")
  const sizes = [
    await ensureValue(sizeId, "s", "S"),
    await ensureValue(sizeId, "m", "M"),
    await ensureValue(sizeId, "l", "L"),
  ]

  const department = await createDepartment(actor, {
    slug: unique("men"),
    name: "Men",
  })
  const tees = await createCategory(actor, {
    departmentId: department.id,
    slug: unique("t-shirts"),
    name: "T-Shirts",
    defaultHsnCode: "6109",
  })
  const oversized = await createCategory(actor, {
    departmentId: department.id,
    parentId: tees.id,
    slug: unique("oversized"),
    name: "Oversized T-Shirts",
  })

  const product = await createProduct(actor, {
    departmentId: department.id,
    slug: unique("midnight-tee"),
    title: "Midnight Oversized Tee",
    description: paragraphs("Heavyweight cotton, dropped shoulders."),
    manufacturerDetails: "Duis Apparel, Mumbai, India",
    weightGrams: 250,
    categoryIds: [oversized.id],
    axisAttributeIds: [colorId, sizeId],
    tags: ["streetwear"],
  })
  const skuPrefix = unique("T").toUpperCase()
  await generateVariants(actor, {
    productId: product.id,
    axes: [
      { attributeId: colorId, valueIds: [black, white] },
      { attributeId: sizeId, valueIds: sizes },
    ],
    pricePaise: 79_900,
    mrpPaise: 99_900,
    skuPrefix,
  })
  const variants = await getDb()
    .select({ id: productVariants.id, sku: productVariants.sku })
    .from(productVariants)
    .where(eq(productVariants.productId, product.id))

  return {
    departmentId: department.id,
    teesId: tees.id,
    oversizedId: oversized.id,
    productId: product.id,
    variants,
    colorId,
    sizeId,
    black,
    white,
  }
}

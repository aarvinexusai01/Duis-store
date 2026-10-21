import "server-only"
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm"

import {
  attributes,
  attributeValues,
  categories,
  departments,
  mediaAssets,
  productAttributes,
  productAttributeValues,
  productCategories,
  productMedia,
  products,
  productVariants,
  sizeCharts,
  variantAttributeValues,
} from "@/db/schema"
import { recordAddressChange, releaseAddress } from "@/features/redirects"
import { richTextToPlainText } from "@/lib/rich-text"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"
import { defineOperation } from "@/server/operation"

import { refreshListingCache, refreshSearchKeywords } from "./derived"
import { loadCatalogTree } from "./storefront"
import {
  createAttributeSchema,
  createAttributeValueSchema,
  createCategorySchema,
  createDepartmentSchema,
  createProductSchema,
  createSizeChartSchema,
  generateVariantsSchema,
  moveCategorySchema,
  productIdSchema,
  setProductMediaSchema,
  updateCategorySchema,
  updateProductSchema,
  updateVariantSchema,
} from "./schemas"

/** ltree label for a category id (hex without hyphens). */
const pathLabel = (id: string) => id.replace(/-/g, "")

async function newId(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ id: string }>(
    sql`select uuidv7()::text as id`,
  )
  return result.rows[0]!.id
}

function conflict(err: unknown, constraint: string, message: string): never {
  if (isUniqueViolation(err, constraint))
    throw new DomainError("CONFLICT", message)
  throw err
}

/** Product changes that affect listings, search and automatic collections. */
async function productChanged(tx: Transaction, productIds: string[]) {
  await refreshSearchKeywords(tx, productIds)
  await refreshListingCache(tx, productIds)
  await requestRevalidation(
    [...productIds.map(cacheTags.product), cacheTags.productsList],
    { tx },
  )
  await enqueue(
    QUEUES.refreshAutoCollections,
    {},
    {
      tx,
      singletonKey: "all-auto-collections",
    },
  )
}

// --- Departments, categories, attributes, size charts ----------------------

export const createDepartment = defineOperation({
  name: "catalog.createDepartment",
  access: { catalog: ["create"] },
  input: createDepartmentSchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const [row] = await tx
        .insert(departments)
        .values(input)
        .returning({ id: departments.id })
        .catch((err) =>
          conflict(
            err,
            "departments_slug_unique",
            "That department already exists.",
          ),
        )
      await writeAudit(tx, actor, {
        action: "department.create",
        entityType: "department",
        entityId: row!.id,
        changes: input,
      })
      await requestRevalidation([cacheTags.categoriesTree], { tx })
      return { id: row!.id }
    })
  },
})

export const createCategory = defineOperation({
  name: "catalog.createCategory",
  access: { catalog: ["create"] },
  input: createCategorySchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      let parentPath: string | null = null
      if (input.parentId) {
        const [parent] = await tx
          .select({
            path: categories.path,
            departmentId: categories.departmentId,
          })
          .from(categories)
          .where(eq(categories.id, input.parentId))
        if (!parent)
          throw new DomainError("NOT_FOUND", "Parent category not found.")
        if (parent.departmentId !== input.departmentId) {
          throw new DomainError(
            "VALIDATION_FAILED",
            "Parent belongs to another department.",
          )
        }
        parentPath = parent.path
      }

      const id = await newId(tx)
      const path = parentPath ? `${parentPath}.${pathLabel(id)}` : pathLabel(id)
      await tx
        .insert(categories)
        .values({ ...input, id, path, parentId: input.parentId ?? null })
        .catch((err) =>
          conflict(
            err,
            "categories_sibling_slug_key",
            "A sibling category already uses that slug.",
          ),
        )

      await writeAudit(tx, actor, {
        action: "category.create",
        entityType: "category",
        entityId: id,
        changes: input,
      })
      await requestRevalidation([cacheTags.categoriesTree], { tx })
      return { id }
    })
  },
})

/** Every category's shop address, for redirecting the ones that move. */
async function categoryHrefs(): Promise<Map<string, string>> {
  const tree = await loadCatalogTree()
  return new Map(tree.categories.map((c) => [c.id, c.href]))
}

/**
 * After a category is renamed or moved, its old address (and those of the
 * categories inside it) redirect to the new ones (owner decision
 * 2026-10-17). Runs after the change commits, since the tree is read fresh.
 */
async function redirectMovedCategories(before: Map<string, string>) {
  const after = await categoryHrefs()
  const moved = [...before].filter(
    ([id, href]) => after.has(id) && after.get(id) !== href,
  )
  if (moved.length === 0) return
  await withTransaction(async (tx) => {
    for (const [id, href] of moved)
      await recordAddressChange(tx, href, after.get(id)!)
  })
}

export const updateCategory = defineOperation({
  name: "catalog.updateCategory",
  access: { catalog: ["update"] },
  input: updateCategorySchema,
  async handler({ actor }, { id, ...changes }) {
    const before = changes.slug ? await categoryHrefs() : null
    const result = await withTransaction(async (tx) => {
      const [row] = await tx
        .update(categories)
        .set(changes)
        .where(eq(categories.id, id))
        .returning({ id: categories.id })
        .catch((err) =>
          conflict(
            err,
            "categories_sibling_slug_key",
            "A sibling category already uses that slug.",
          ),
        )
      if (!row) throw new DomainError("NOT_FOUND", "Category not found.")

      await writeAudit(tx, actor, {
        action: "category.update",
        entityType: "category",
        entityId: id,
        changes,
      })
      await requestRevalidation(
        [cacheTags.category(id), cacheTags.categoriesTree],
        { tx },
      )
      return { id }
    })
    if (before) await redirectMovedCategories(before)
    return result
  },
})

/** Moves a category (and its subtree) under a new parent, or to the root. */
export const moveCategory = defineOperation({
  name: "catalog.moveCategory",
  access: { catalog: ["update"] },
  input: moveCategorySchema,
  async handler({ actor }, { id, parentId }) {
    const before = await categoryHrefs()
    const result = await withTransaction(async (tx) => {
      const [category] = await tx
        .select({
          path: categories.path,
          departmentId: categories.departmentId,
        })
        .from(categories)
        .where(eq(categories.id, id))
        .for("update")
      if (!category) throw new DomainError("NOT_FOUND", "Category not found.")

      let prefix = pathLabel(id)
      if (parentId) {
        const [parent] = await tx
          .select({
            path: categories.path,
            departmentId: categories.departmentId,
          })
          .from(categories)
          .where(eq(categories.id, parentId))
        if (!parent)
          throw new DomainError("NOT_FOUND", "Parent category not found.")
        if (parent.departmentId !== category.departmentId) {
          throw new DomainError(
            "VALIDATION_FAILED",
            "Categories cannot move between departments.",
          )
        }
        const inside = await tx.execute<{ inside: boolean }>(
          sql`select ${parent.path}::ltree <@ ${category.path}::ltree as inside`,
        )
        if (inside.rows[0]?.inside) {
          throw new DomainError(
            "INVALID_STATE",
            "A category cannot move inside itself.",
          )
        }
        prefix = `${parent.path}.${pathLabel(id)}`
      }

      await tx
        .update(categories)
        .set({ parentId })
        .where(eq(categories.id, id))
        .catch((err) =>
          conflict(
            err,
            "categories_sibling_slug_key",
            "The new parent already has a category with that slug.",
          ),
        )
      // Rewrite the subtree: new prefix + each row's path below the old node.
      // (subpath() rejects an offset equal to the length, hence the CASE.)
      await tx.execute(sql`
        update categories
        set path = case
          when path = ${category.path}::ltree then ${prefix}::ltree
          else ${prefix}::ltree || subpath(path, nlevel(${category.path}::ltree))
        end
        where path <@ ${category.path}::ltree
      `)

      await writeAudit(tx, actor, {
        action: "category.move",
        entityType: "category",
        entityId: id,
        changes: { parentId },
      })
      await requestRevalidation([cacheTags.categoriesTree], { tx })
      return { id }
    })
    await redirectMovedCategories(before)
    return result
  },
})

export const createAttribute = defineOperation({
  name: "catalog.createAttribute",
  access: { catalog: ["create"] },
  input: createAttributeSchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const [row] = await tx
        .insert(attributes)
        .values(input)
        .returning({ id: attributes.id })
        .catch((err) =>
          conflict(
            err,
            "attributes_code_unique",
            "That attribute already exists.",
          ),
        )
      await writeAudit(tx, actor, {
        action: "attribute.create",
        entityType: "attribute",
        entityId: row!.id,
        changes: input,
      })
      return { id: row!.id }
    })
  },
})

export const createAttributeValue = defineOperation({
  name: "catalog.createAttributeValue",
  access: { catalog: ["create"] },
  input: createAttributeValueSchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const [row] = await tx
        .insert(attributeValues)
        .values(input)
        .returning({ id: attributeValues.id })
        .catch((err) =>
          conflict(
            err,
            "attribute_values_attribute_slug_key",
            "That value already exists.",
          ),
        )
      await writeAudit(tx, actor, {
        action: "attribute_value.create",
        entityType: "attribute_value",
        entityId: row!.id,
        changes: input,
      })
      return { id: row!.id }
    })
  },
})

export const createSizeChart = defineOperation({
  name: "catalog.createSizeChart",
  access: { catalog: ["create"] },
  input: createSizeChartSchema,
  async handler({ actor }, input) {
    for (const row of input.chart.rows) {
      if (row.values.length !== input.chart.columns.length) {
        throw new DomainError(
          "VALIDATION_FAILED",
          `Size ${row.size} needs one value per column.`,
        )
      }
    }
    return withTransaction(async (tx) => {
      const [row] = await tx
        .insert(sizeCharts)
        .values(input)
        .returning({ id: sizeCharts.id })
      await writeAudit(tx, actor, {
        action: "size_chart.create",
        entityType: "size_chart",
        entityId: row!.id,
        changes: { name: input.name },
      })
      return { id: row!.id }
    })
  },
})

// --- Products ----------------------------------------------------------------

async function assertCategories(
  tx: Transaction,
  departmentId: string,
  ids: string[],
) {
  const rows = await tx
    .select({ id: categories.id, departmentId: categories.departmentId })
    .from(categories)
    .where(inArray(categories.id, ids))
  if (
    rows.length !== new Set(ids).size ||
    rows.some((row) => row.departmentId !== departmentId)
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Every category must exist in the product's department.",
    )
  }
}

/** The nearest HSN code on the primary category or one of its ancestors. */
async function inheritedHsnCode(
  tx: Transaction,
  categoryId: string,
): Promise<string | null> {
  const result = await tx.execute<{ hsn: string | null }>(sql`
    select ancestor.default_hsn_code as hsn
    from categories c
    join categories ancestor on ancestor.path @> c.path
    where c.id = ${categoryId} and ancestor.default_hsn_code is not null
    order by nlevel(ancestor.path) desc
    limit 1
  `)
  return result.rows[0]?.hsn ?? null
}

async function replaceCategories(
  tx: Transaction,
  productId: string,
  categoryIds: string[],
) {
  await tx
    .delete(productCategories)
    .where(eq(productCategories.productId, productId))
  await tx.insert(productCategories).values(
    [...new Set(categoryIds)].map((categoryId, index) => ({
      productId,
      categoryId,
      isPrimary: index === 0,
    })),
  )
}

async function replaceDescriptiveValues(
  tx: Transaction,
  productId: string,
  valueIds: string[],
) {
  await tx
    .delete(productAttributeValues)
    .where(eq(productAttributeValues.productId, productId))
  if (valueIds.length === 0) return
  const rows = await tx
    .select({ id: attributeValues.id, isAxis: attributes.isVariantAxis })
    .from(attributeValues)
    .innerJoin(attributes, eq(attributes.id, attributeValues.attributeId))
    .where(inArray(attributeValues.id, valueIds))
  if (
    rows.length !== new Set(valueIds).size ||
    rows.some((row) => row.isAxis)
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Descriptive values must exist and must not be variant axes (use variants for those).",
    )
  }
  await tx.insert(productAttributeValues).values(
    [...new Set(valueIds)].map((attributeValueId) => ({
      productId,
      attributeValueId,
    })),
  )
}

export const createProduct = defineOperation({
  name: "catalog.createProduct",
  access: { catalog: ["create"] },
  input: createProductSchema,
  async handler({ actor }, input) {
    const { categoryIds, axisAttributeIds, descriptiveValueIds, ...fields } =
      input
    return withTransaction(async (tx) => {
      await assertCategories(tx, input.departmentId, categoryIds)

      const axes = await tx
        .select({ id: attributes.id, isAxis: attributes.isVariantAxis })
        .from(attributes)
        .where(inArray(attributes.id, axisAttributeIds))
      if (
        axes.length !== new Set(axisAttributeIds).size ||
        axes.some((axis) => !axis.isAxis)
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Variant axes must be variant attributes.",
        )
      }

      const hsnCode =
        fields.hsnCode ?? (await inheritedHsnCode(tx, categoryIds[0]!))
      if (!hsnCode) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Set an HSN code on the product or its category.",
        )
      }

      const [product] = await tx
        .insert(products)
        .values({
          ...fields,
          hsnCode,
          descriptionText: richTextToPlainText(fields.description),
          createdBy: actor.kind === "user" ? actor.userId : null,
        })
        .returning({ id: products.id })
        .catch((err) =>
          conflict(
            err,
            "products_slug_unique",
            "Another product already uses that slug.",
          ),
        )
      const productId = product!.id

      await replaceCategories(tx, productId, categoryIds)
      await tx.insert(productAttributes).values(
        axisAttributeIds.map((attributeId, position) => ({
          productId,
          attributeId,
          position,
        })),
      )
      await replaceDescriptiveValues(tx, productId, descriptiveValueIds)
      await refreshSearchKeywords(tx, [productId])
      await refreshListingCache(tx, [productId])

      await writeAudit(tx, actor, {
        action: "product.create",
        entityType: "product",
        entityId: productId,
        changes: { slug: input.slug, title: input.title },
      })
      return { id: productId }
    })
  },
})

export const updateProduct = defineOperation({
  name: "catalog.updateProduct",
  access: { catalog: ["update"] },
  input: updateProductSchema,
  async handler(
    { actor },
    { id, categoryIds, descriptiveValueIds, expectedVersion, ...fields },
  ) {
    return withTransaction(async (tx) => {
      const [current] = await tx
        .select({
          departmentId: products.departmentId,
          slug: products.slug,
          publishedAt: products.publishedAt,
          updatedAt: products.updatedAt,
        })
        .from(products)
        .where(eq(products.id, id))
        .for("update")
      if (!current) throw new DomainError("NOT_FOUND", "Product not found.")
      // Two staff editing at once: the later save must not silently undo the
      // earlier one (race test A3).
      if (
        expectedVersion &&
        current.updatedAt.getTime() !== new Date(expectedVersion).getTime()
      ) {
        throw new DomainError(
          "CONFLICT",
          "Someone else saved this product after you opened it. Reload to see their changes, then make yours again.",
        )
      }

      // Every save moves the version on, even one that only changes categories.
      const changes: Partial<typeof products.$inferInsert> = {
        ...fields,
        updatedAt: new Date(),
      }
      if (fields.description !== undefined) {
        changes.descriptionText = richTextToPlainText(fields.description)
      }
      {
        await tx
          .update(products)
          .set(changes)
          .where(eq(products.id, id))
          .catch((err) =>
            conflict(
              err,
              "products_slug_unique",
              "Another product already uses that slug.",
            ),
          )
      }
      // A product that has been live keeps its old address working.
      if (fields.slug && fields.slug !== current.slug) {
        if (current.publishedAt)
          await recordAddressChange(
            tx,
            `/products/${current.slug}`,
            `/products/${fields.slug}`,
          )
        else await releaseAddress(tx, `/products/${fields.slug}`)
      }
      if (categoryIds) {
        await assertCategories(tx, current.departmentId, categoryIds)
        await replaceCategories(tx, id, categoryIds)
      }
      if (descriptiveValueIds)
        await replaceDescriptiveValues(tx, id, descriptiveValueIds)

      await productChanged(tx, [id])
      await writeAudit(tx, actor, {
        action: "product.update",
        entityType: "product",
        entityId: id,
        changes: { ...fields, categoryIds, descriptiveValueIds },
      })
      return { id, version: (changes.updatedAt as Date).toISOString() }
    })
  },
})

/** Creates every missing combination of the given axis values. */
export const generateVariants = defineOperation({
  name: "catalog.generateVariants",
  access: { catalog: ["update"] },
  input: generateVariantsSchema,
  async handler({ actor }, input) {
    if (input.mrpPaise < input.pricePaise) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "MRP cannot be lower than the selling price.",
      )
    }
    return withTransaction(async (tx) => {
      const productAxes = await tx
        .select({
          attributeId: productAttributes.attributeId,
          position: productAttributes.position,
          code: attributes.code,
        })
        .from(productAttributes)
        .innerJoin(attributes, eq(attributes.id, productAttributes.attributeId))
        .where(eq(productAttributes.productId, input.productId))
        .orderBy(asc(productAttributes.position))
      if (productAxes.length === 0)
        throw new DomainError("NOT_FOUND", "Product not found.")

      const requested = new Map(
        input.axes.map((axis) => [axis.attributeId, axis.valueIds]),
      )
      if (
        requested.size !== productAxes.length ||
        productAxes.some((axis) => !requested.has(axis.attributeId))
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Provide values for exactly the product's variant axes.",
        )
      }

      const valueIds = input.axes.flatMap((axis) => axis.valueIds)
      const values = await tx
        .select({
          id: attributeValues.id,
          attributeId: attributeValues.attributeId,
          slug: attributeValues.slug,
        })
        .from(attributeValues)
        .where(inArray(attributeValues.id, valueIds))
      const valueById = new Map(values.map((value) => [value.id, value]))
      for (const axis of input.axes) {
        for (const valueId of axis.valueIds) {
          if (valueById.get(valueId)?.attributeId !== axis.attributeId) {
            throw new DomainError(
              "VALIDATION_FAILED",
              "A value does not belong to its attribute.",
            )
          }
        }
      }

      // Cartesian product in axis display order.
      let combos: string[][] = [[]]
      for (const axis of productAxes) {
        const ids = [...new Set(requested.get(axis.attributeId)!)]
        combos = combos.flatMap((combo) =>
          ids.map((valueId) => [...combo, valueId]),
        )
      }

      const existing = await tx
        .select({
          signature: productVariants.optionSignature,
          position: productVariants.position,
        })
        .from(productVariants)
        .where(eq(productVariants.productId, input.productId))
      const taken = new Set(existing.map((row) => row.signature))
      let position =
        existing.reduce((max, row) => Math.max(max, row.position), -1) + 1

      let created = 0
      for (const combo of combos) {
        const parts = combo.map(
          (valueId, index) =>
            `${productAxes[index]!.code}=${valueById.get(valueId)!.slug}`,
        )
        const signature = parts.join(";")
        if (taken.has(signature)) continue

        const sku = [
          input.skuPrefix,
          ...combo.map((valueId) => valueById.get(valueId)!.slug.toUpperCase()),
        ]
          .join("-")
          .slice(0, 60)
        const [variant] = await tx
          .insert(productVariants)
          .values({
            productId: input.productId,
            sku,
            pricePaise: input.pricePaise,
            mrpPaise: input.mrpPaise,
            optionSignature: signature,
            position: position++,
          })
          .returning({ id: productVariants.id })
          .catch((err) =>
            conflict(
              err,
              "product_variants_sku_unique",
              `SKU ${sku} is already in use.`,
            ),
          )
        await tx.insert(variantAttributeValues).values(
          combo.map((attributeValueId, index) => ({
            variantId: variant!.id,
            attributeId: productAxes[index]!.attributeId,
            attributeValueId,
          })),
        )
        created++
      }

      await productChanged(tx, [input.productId])
      await writeAudit(tx, actor, {
        action: "product.generate_variants",
        entityType: "product",
        entityId: input.productId,
        changes: {
          created,
          skipped: combos.length - created,
          pricePaise: input.pricePaise,
        },
      })
      return { created, skipped: combos.length - created }
    })
  },
})

export const updateVariant = defineOperation({
  name: "catalog.updateVariant",
  access: { catalog: ["update"] },
  input: updateVariantSchema,
  async handler({ actor }, { id, ...changes }) {
    return withTransaction(async (tx) => {
      const [current] = await tx
        .select({
          productId: productVariants.productId,
          pricePaise: productVariants.pricePaise,
          mrpPaise: productVariants.mrpPaise,
        })
        .from(productVariants)
        .where(eq(productVariants.id, id))
        .for("update")
      if (!current) throw new DomainError("NOT_FOUND", "Variant not found.")
      const price = changes.pricePaise ?? current.pricePaise
      const mrp = changes.mrpPaise ?? current.mrpPaise
      if (mrp < price)
        throw new DomainError(
          "VALIDATION_FAILED",
          "MRP cannot be lower than the selling price.",
        )

      await tx
        .update(productVariants)
        .set(changes)
        .where(eq(productVariants.id, id))
        .catch((err) =>
          conflict(
            err,
            "product_variants_sku_unique",
            "That SKU is already in use.",
          ),
        )

      await productChanged(tx, [current.productId])
      await writeAudit(tx, actor, {
        action: "variant.update",
        entityType: "product_variant",
        entityId: id,
        changes: {
          before: {
            pricePaise: current.pricePaise,
            mrpPaise: current.mrpPaise,
          },
          after: changes,
        },
      })
      return { id }
    })
  },
})

export const setProductMedia = defineOperation({
  name: "catalog.setProductMedia",
  access: { catalog: ["update"] },
  input: setProductMediaSchema,
  async handler({ actor }, { productId, items }) {
    return withTransaction(async (tx) => {
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId))
      if (!product) throw new DomainError("NOT_FOUND", "Product not found.")

      const mediaIds = [...new Set(items.map((item) => item.mediaId))]
      if (mediaIds.length !== items.length) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Each image can appear once per product.",
        )
      }
      if (mediaIds.length > 0) {
        const found = await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(
            and(
              inArray(mediaAssets.id, mediaIds),
              isNull(mediaAssets.deletedAt),
            ),
          )
        if (found.length !== mediaIds.length)
          throw new DomainError(
            "VALIDATION_FAILED",
            "Some images do not exist.",
          )
      }

      const colourIds = [
        ...new Set(
          items.flatMap((item) =>
            item.colorValueId ? [item.colorValueId] : [],
          ),
        ),
      ]
      if (colourIds.length > 0) {
        const colours = await tx
          .select({ id: attributeValues.id })
          .from(attributeValues)
          .innerJoin(attributes, eq(attributes.id, attributeValues.attributeId))
          .where(
            and(
              inArray(attributeValues.id, colourIds),
              eq(attributes.code, "color"),
            ),
          )
        if (colours.length !== colourIds.length) {
          throw new DomainError(
            "VALIDATION_FAILED",
            "Image colours must be colour values.",
          )
        }
      }

      await tx.delete(productMedia).where(eq(productMedia.productId, productId))
      if (items.length > 0) {
        await tx.insert(productMedia).values(
          items.map((item, position) => ({
            productId,
            mediaId: item.mediaId,
            colorValueId: item.colorValueId ?? null,
            altOverride: item.altOverride ?? null,
            position,
          })),
        )
      }

      await refreshListingCache(tx, [productId])
      await requestRevalidation(
        [cacheTags.product(productId), cacheTags.productsList],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "product.set_media",
        entityType: "product",
        entityId: productId,
        changes: { mediaIds },
      })
      return { count: items.length }
    })
  },
})

export const publishProduct = defineOperation({
  name: "catalog.publishProduct",
  access: { catalog: ["publish"] },
  input: productIdSchema,
  async handler({ actor }, { id }) {
    return withTransaction(async (tx) => {
      const [product] = await tx
        .select({ status: products.status })
        .from(products)
        .where(eq(products.id, id))
        .for("update")
      if (!product) throw new DomainError("NOT_FOUND", "Product not found.")

      const problems: string[] = []
      const [{ variants = 0 } = {}] = await tx
        .select({ variants: sql<number>`count(*)::int` })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.productId, id),
            eq(productVariants.status, "active"),
          ),
        )
      if (variants === 0) problems.push("Add at least one active variant.")
      const [{ images = 0 } = {}] = await tx
        .select({ images: sql<number>`count(*)::int` })
        .from(productMedia)
        .where(eq(productMedia.productId, id))
      if (images === 0) problems.push("Add at least one image.")
      if (problems.length > 0) {
        throw new DomainError(
          "INVALID_STATE",
          "This product is not ready to publish.",
          { problems },
        )
      }

      await tx
        .update(products)
        .set({
          status: "active",
          publishedAt: sql`coalesce(${products.publishedAt}, now())`,
        })
        .where(eq(products.id, id))
      await productChanged(tx, [id])
      await writeAudit(tx, actor, {
        action: "product.publish",
        entityType: "product",
        entityId: id,
        changes: { from: product.status, to: "active" },
      })
      return { id }
    })
  },
})

export const archiveProduct = defineOperation({
  name: "catalog.archiveProduct",
  access: { catalog: ["archive"] },
  input: productIdSchema,
  async handler({ actor }, { id }) {
    return withTransaction(async (tx) => {
      const [row] = await tx
        .update(products)
        .set({ status: "archived" })
        .where(and(eq(products.id, id), ne(products.status, "archived")))
        .returning({ id: products.id })
      if (!row)
        throw new DomainError(
          "NOT_FOUND",
          "Product not found or already archived.",
        )
      await productChanged(tx, [id])
      await writeAudit(tx, actor, {
        action: "product.archive",
        entityType: "product",
        entityId: id,
      })
      return { id }
    })
  },
})

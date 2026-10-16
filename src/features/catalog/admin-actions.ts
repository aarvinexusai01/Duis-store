"use server"

import type { Route } from "next"
import { refresh } from "next/cache"
import { redirect } from "next/navigation"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import {
  adminListProducts,
  duplicateProduct,
  updateAttributeValue,
  updateSizeChart,
} from "./admin"
import {
  archiveProduct,
  createAttribute,
  createAttributeValue,
  createCategory,
  createProduct,
  createSizeChart,
  generateVariants,
  moveCategory,
  publishProduct,
  setProductMedia,
  updateCategory,
  updateProduct,
  updateVariant,
} from "./service"

export type AdminResult<T = object> =
  ({ ok: true } & T) | ({ ok: false } & ActionError)

/** Runs an operation as the signed-in staff member and refreshes the page. */
async function run<T extends object>(
  work: () => Promise<T>,
): Promise<AdminResult<T>> {
  try {
    const value = await work()
    refresh()
    return { ok: true, ...value }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

type Input<F extends (actor: never, input: never) => unknown> = Parameters<F>[1]

export async function createProductAction(input: Input<typeof createProduct>) {
  const result = await run(async () => createProduct(await getActor(), input))
  if (result.ok) redirect(`/admin/products/${result.id}` as Route)
  return result
}

export async function updateProductAction(input: Input<typeof updateProduct>) {
  return run(async () => updateProduct(await getActor(), input))
}

export async function publishProductAction(id: string) {
  return run(async () => {
    await publishProduct(await getActor(), { id })
    return {}
  })
}

export async function archiveProductAction(id: string) {
  return run(async () => {
    await archiveProduct(await getActor(), { id })
    return {}
  })
}

export async function duplicateProductAction(id: string, slug: string) {
  const result = await run(async () =>
    duplicateProduct(await getActor(), { id, slug }),
  )
  if (result.ok) redirect(`/admin/products/${result.id}` as Route)
  return result
}

/** Bulk publish/archive from the product list (a form post). */
export async function bulkProductAction(form: FormData): Promise<void> {
  const actor = await getActor()
  const ids = form.getAll("ids").map(String)
  const intent = form.get("intent")
  for (const id of ids) {
    try {
      if (intent === "publish") await publishProduct(actor, { id })
      if (intent === "archive") await archiveProduct(actor, { id })
    } catch (error) {
      // Skip products that can't change (e.g. no image yet); the list shows their status.
      toActionError(error)
    }
  }
  refresh()
}

export async function generateVariantsAction(
  input: Input<typeof generateVariants>,
) {
  return run(async () => generateVariants(await getActor(), input))
}

export async function saveVariantsAction(
  changes: Input<typeof updateVariant>[],
) {
  return run(async () => {
    const actor = await getActor()
    for (const change of changes) await updateVariant(actor, change)
    return { saved: changes.length }
  })
}

export async function setProductMediaAction(
  input: Input<typeof setProductMedia>,
) {
  return run(async () => {
    await setProductMedia(await getActor(), input)
    return {}
  })
}

export async function createCategoryAction(
  input: Input<typeof createCategory>,
) {
  return run(async () => createCategory(await getActor(), input))
}

export async function updateCategoryAction(
  input: Input<typeof updateCategory>,
) {
  return run(async () => updateCategory(await getActor(), input))
}

export async function moveCategoryAction(input: Input<typeof moveCategory>) {
  return run(async () => {
    await moveCategory(await getActor(), input)
    return {}
  })
}

export async function createAttributeAction(
  input: Input<typeof createAttribute>,
) {
  return run(async () => createAttribute(await getActor(), input))
}

export async function createAttributeValueAction(
  input: Input<typeof createAttributeValue>,
) {
  return run(async () => createAttributeValue(await getActor(), input))
}

export async function updateAttributeValueAction(
  input: Input<typeof updateAttributeValue>,
) {
  return run(async () => updateAttributeValue(await getActor(), input))
}

export async function createSizeChartAction(
  input: Input<typeof createSizeChart>,
) {
  return run(async () => createSizeChart(await getActor(), input))
}

export async function updateSizeChartAction(
  input: Input<typeof updateSizeChart>,
) {
  return run(async () => updateSizeChart(await getActor(), input))
}

/** Product search for pickers (collections, CMS). */
export async function searchProductsAction(q: string) {
  try {
    const { rows } = await adminListProducts(await getActor(), { q, page: 1 })
    return { ok: true as const, rows: rows.slice(0, 20) }
  } catch (error) {
    return { ok: false as const, ...toActionError(error) }
  }
}

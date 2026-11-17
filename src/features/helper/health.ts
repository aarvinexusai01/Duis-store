import type { AdminProduct, CatalogOptions } from "@/features/catalog"
import { richTextToPlainText } from "@/lib/rich-text"

/**
 * "Ready to sell?" for one product (the helper's health check). Blockers are
 * the rules publishing already enforces; warnings never stop a publish
 * (owner decision 2026-11-17).
 */
export type HealthItem = {
  key: string
  level: "blocker" | "warning"
  message: string
  /** Where it's fixed: a tab of the product page, or another admin page. */
  fix: { tab: "details" | "media" | "variants" } | { href: string }
  fixLabel: string
}

type Product = Pick<
  AdminProduct,
  "description" | "categoryIds" | "variants" | "media"
>
type Options = Pick<CatalogOptions, "categories" | "attributes">

function list(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

export function productHealth(
  product: Product,
  options: Options,
): HealthItem[] {
  const items: HealthItem[] = []
  const active = product.variants.filter((v) => v.status === "active")

  if (product.media.length === 0) {
    items.push({
      key: "photos",
      level: "blocker",
      message: "No photos yet. A product needs at least one to be published.",
      fix: { tab: "media" },
      fixLabel: "Add photos",
    })
  }
  if (active.length === 0) {
    items.push({
      key: "variants",
      level: "blocker",
      message:
        "No colours or sizes yet. Generate variants so customers can choose one.",
      fix: { tab: "variants" },
      fixLabel: "Generate variants",
    })
  }

  const available = (v: (typeof active)[number]) => v.onHand - v.reserved
  const soldOut = active.filter((v) => available(v) <= 0)
  if (active.length > 0 && soldOut.length === active.length) {
    items.push({
      key: "stock",
      level: "warning",
      message: "Nothing is in stock, so customers can't buy it yet.",
      fix: { tab: "variants" },
      fixLabel: "Add stock",
    })
  } else if (soldOut.length > 0) {
    items.push({
      key: "sold-out",
      level: "warning",
      message: `${soldOut.length} ${soldOut.length === 1 ? "size is" : "sizes are"} sold out: ${list(soldOut.slice(0, 3).map((v) => v.label))}${soldOut.length > 3 ? "…" : ""}.`,
      fix: { tab: "variants" },
      fixLabel: "Add stock",
    })
  }

  // With two or more colours, each needs its own photo; with one, untagged
  // photos are that colour's photos.
  const colourValues =
    options.attributes.find((a) => a.code === "color")?.values ?? []
  const colourSlugs = [
    ...new Set(active.map((v) => v.options.color).filter(Boolean)),
  ] as string[]
  if (colourSlugs.length >= 2) {
    const tagged = new Set(product.media.map((m) => m.colorValueId))
    const missing = colourSlugs
      .map((slug) => colourValues.find((value) => value.slug === slug))
      .filter((value) => value && !tagged.has(value.id))
      .map((value) => value!.label)
    if (missing.length > 0) {
      items.push({
        key: "colour-photos",
        level: "warning",
        message: `${list(missing)} ${missing.length === 1 ? "has" : "have"} no photo of ${missing.length === 1 ? "its" : "their"} own, so customers see another colour.`,
        fix: { tab: "media" },
        fixLabel: "Tag photos",
      })
    }
  }

  const text = product.description
    ? richTextToPlainText(product.description).trim()
    : ""
  if (!text) {
    items.push({
      key: "description",
      level: "warning",
      message: "No description. Say what it's made of and how it fits.",
      fix: { tab: "details" },
      fixLabel: "Write one",
    })
  }

  // The shop shows the nearest size chart up the main category's tree.
  const byId = new Map(options.categories.map((c) => [c.id, c]))
  let category = byId.get(product.categoryIds[0] ?? "")
  const main = category
  let chart = false
  while (category && !chart) {
    chart = !!category.sizeChartId
    category = category.parentId ? byId.get(category.parentId) : undefined
  }
  if (main && !chart) {
    items.push({
      key: "size-chart",
      level: "warning",
      message: `${main.name} has no size chart, so customers can't check the fit.`,
      fix: { href: "/admin/categories" },
      fixLabel: "Add a size chart",
    })
  }

  return items
}

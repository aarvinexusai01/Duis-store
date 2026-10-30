import { z } from "zod"

/** SEO overrides shared by products, categories, collections and pages. */
export const seoSchema = z.object({
  seoTitle: z.string().max(70).nullish(),
  seoDescription: z.string().max(170).nullish(),
  noindex: z.boolean().optional(),
})

/**
 * Search-result titles and descriptions (Phase 11). Google shows about 60
 * characters of a title and 155–160 of a description; the root layout adds
 * " | Duis" to every title.
 */

export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 155
const BRAND_SUFFIX = " | Duis"

/**
 * The most descriptive candidate that still fits once " | Duis" is added.
 * Candidates go from richest ("Polo T-Shirts for Men — Buy Online in India")
 * to plainest ("Polo T-Shirts"); the last one is used even if it's long.
 */
export function fitTitle(...candidates: string[]): string {
  const fits = candidates.find(
    (title) => title.length + BRAND_SUFFIX.length <= TITLE_MAX,
  )
  return fits ?? candidates[candidates.length - 1] ?? ""
}

/** Whitespace collapsed and cut at a word boundary, with an ellipsis. */
export function fitDescription(text: string, max = DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\-–—\s]+$/, "")}…`
}

/** "₹999": whole rupees for search snippets. */
export function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`
}

/** The store's promises, from its settings (cash on delivery matters most in India). */
export function storePromises(policy: {
  freeShippingThresholdPaise: number
  exchangeWindowDays: number
  partialCodEnabled: boolean
}): string {
  const parts = [
    `free shipping above ${rupees(policy.freeShippingThresholdPaise)}`,
  ]
  if (policy.partialCodEnabled) parts.push("cash on delivery")
  parts.push(`easy ${policy.exchangeWindowDays}-day exchanges`)
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
      : parts[0]!
  return `${list[0]!.toUpperCase()}${list.slice(1)}.`
}

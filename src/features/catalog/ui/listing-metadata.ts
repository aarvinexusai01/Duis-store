import type { Metadata } from "next"

import { SITE } from "@/config/site"
import { hasFilters, type ListingParams } from "@/lib/listing-params"

/**
 * One indexable URL per listing: filtered or re-sorted variants are noindex
 * and point their canonical at the plain listing; pages 2+ of the plain
 * listing are canonical to themselves.
 */
export function listingMetadata(input: {
  title: string
  description?: string | null
  basePath: string
  params: ListingParams
  noindex?: boolean
}): Metadata {
  const variant = hasFilters(input.params) || input.params.sort !== "featured"
  const page =
    !variant && input.params.page > 1 ? `?page=${input.params.page}` : ""
  return {
    title:
      input.params.page > 1
        ? // The short name, so "— page N" still fits in 60 characters.
          `${input.title.split(" — ")[0]} — page ${input.params.page}`
        : input.title,
    // Later pages get their own description, so none repeats page 1's.
    description: `${input.params.page > 1 ? `Page ${input.params.page}: ` : ""}${
      input.description ??
      `Shop ${input.title} at ${SITE.name}. ${SITE.defaultDescription}`
    }`,
    alternates: { canonical: `${input.basePath}${page}` },
    robots:
      variant || input.noindex ? { index: false, follow: true } : undefined,
  }
}

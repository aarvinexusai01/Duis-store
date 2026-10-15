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
        ? `${input.title} — page ${input.params.page}`
        : input.title,
    description:
      input.description ??
      `Shop ${input.title} at ${SITE.name}. ${SITE.defaultDescription}`,
    alternates: { canonical: `${input.basePath}${page}` },
    robots:
      variant || input.noindex ? { index: false, follow: true } : undefined,
  }
}

import "server-only"
import { cacheLife, cacheTag } from "next/cache"

import { cacheTags } from "@/server/cache/tags"

import { loadCollectionBySlug, loadPublishedCollections } from "./storefront"

/** Cached collection reads for Server Components (ADR-016 applies). */

export async function getCollectionBySlug(slug: string) {
  "use cache"
  cacheLife("hours")
  const collection = await loadCollectionBySlug(slug)
  // Publishing a collection revalidates the list tag, so a slug that is not
  // live yet is picked up then.
  cacheTag(
    collection
      ? cacheTags.collection(collection.id)
      : cacheTags.collectionsList,
  )
  return collection
}

export async function getPublishedCollections() {
  "use cache"
  cacheTag(cacheTags.collectionsList)
  cacheLife("hours")
  return loadPublishedCollections()
}

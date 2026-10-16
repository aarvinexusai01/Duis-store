import "server-only"
import { cacheLife, cacheTag } from "next/cache"

import { cacheTags } from "@/server/cache/tags"

import { loadStorePolicy } from "./policy"

/**
 * The store rules for storefront pages, cached until staff change a setting
 * (which revalidates the tag). Like every cached read, callers reach it only
 * after a request-time API (ADR-016).
 */
export async function getStorePolicy() {
  "use cache"
  cacheTag(cacheTags.storeSettings)
  cacheLife("days")
  return loadStorePolicy()
}

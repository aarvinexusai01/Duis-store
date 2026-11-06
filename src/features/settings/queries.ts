import "server-only"
import { cacheLife, cacheTag } from "next/cache"

import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"

import { loadStorePolicy } from "./policy"
import { loadStorefrontUsdPricing } from "./usd"

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

/** The dollar terms for /api/pricing, cached until a USD setting or rate changes. */
export async function getStorefrontUsdPricing() {
  "use cache"
  cacheTag(cacheTags.storeSettings, cacheTags.fxRates)
  cacheLife("hours")
  return loadStorefrontUsdPricing(getDb())
}

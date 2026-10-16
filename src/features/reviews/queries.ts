import "server-only"
import { cacheLife, cacheTag } from "next/cache"

import { cacheTags } from "@/server/cache/tags"

import { loadProductReviews } from "./service"

/**
 * A product's approved reviews for its page, cached with the product's tag
 * (moderation revalidates it). Callers reach it after a request-time API.
 */
export async function getProductReviews(productId: string) {
  "use cache"
  cacheTag(cacheTags.product(productId))
  cacheLife("hours")
  return loadProductReviews(productId)
}

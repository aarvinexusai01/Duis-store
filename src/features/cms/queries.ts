import "server-only"
import { cacheLife, cacheTag } from "next/cache"

import { cacheTags } from "@/server/cache/tags"

import {
  loadPublishedNavigation,
  loadPublishedPage,
  loadPublishedSiteSettings,
} from "./service"

/**
 * Cached reads for Server Components. Per ADR-016, callers must reach these
 * after a request-time API (e.g. `await connection()`), never during the
 * build. Publishing revalidates the tags.
 */
export async function getPublishedPage(slug: string) {
  "use cache"
  cacheTag(cacheTags.cmsPage(slug))
  cacheLife("hours")
  return loadPublishedPage(slug)
}

export async function getPublishedNavigation(key: string) {
  "use cache"
  cacheTag(cacheTags.cmsNavigation)
  cacheLife("hours")
  return loadPublishedNavigation(key)
}

export async function getPublishedSiteSettings() {
  "use cache"
  cacheTag(cacheTags.cmsSettings)
  cacheLife("hours")
  return loadPublishedSiteSettings()
}

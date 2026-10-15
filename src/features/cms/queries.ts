import "server-only"
import { cacheLife, cacheTag } from "next/cache"

import { loadCatalogTree } from "@/features/catalog"
import { cacheTags } from "@/server/cache/tags"

import { resolveNavigation, resolvePageBlocks } from "./resolve"
import {
  loadPublishedNavigation,
  loadPublishedPage,
  loadPublishedPageList,
  loadPublishedSiteSettings,
} from "./service"

// Resolved content embeds product cards, collections and category links, so
// it is also invalidated when any of those change.
const CATALOGUE_TAGS = [
  cacheTags.productsList,
  cacheTags.collectionsList,
  cacheTags.categoriesTree,
]

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

/** A published page with its sections resolved for rendering. */
export async function getResolvedPage(slug: string) {
  "use cache"
  cacheTag(cacheTags.cmsPage(slug), ...CATALOGUE_TAGS)
  cacheLife("hours")
  const page = await loadPublishedPage(slug)
  if (!page) return null
  const blocks = await resolvePageBlocks(page.data, await loadCatalogTree())
  return { ...page, blocks }
}

/** A published menu (`header`, `footer`, `mobile`, `social`) with real hrefs. */
export async function getResolvedNavigation(key: string) {
  "use cache"
  cacheTag(cacheTags.cmsNavigation, ...CATALOGUE_TAGS)
  cacheLife("hours")
  const navigation = await loadPublishedNavigation(key)
  if (!navigation) return []
  return resolveNavigation(navigation, await loadCatalogTree())
}

export async function getPublishedPageList() {
  "use cache"
  cacheTag(cacheTags.cmsPagesList)
  cacheLife("hours")
  return loadPublishedPageList()
}

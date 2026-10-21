import "server-only"
import { cacheLife, cacheTag } from "next/cache"

import { loadCatalogTree } from "@/features/catalog"
import { cacheTags } from "@/server/cache/tags"

import {
  loadJournalCategories,
  loadJournalFeed,
  loadJournalList,
  loadJournalPost,
  loadJournalTerm,
  loadRelatedPosts,
  type JournalFilter,
} from "./journal"
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

// --- The Journal ----------------------------------------------------------------------

/** Lists change when any post, author, category or tag does. */
export async function getJournalList(filter: JournalFilter, page = 1) {
  "use cache"
  cacheTag(cacheTags.journalList)
  cacheLife("hours")
  return loadJournalList(filter, page)
}

export async function getJournalTerm(
  kind: "category" | "tag" | "author",
  slug: string,
) {
  "use cache"
  cacheTag(cacheTags.journalList)
  cacheLife("hours")
  return loadJournalTerm(kind, slug)
}

export async function getJournalCategories() {
  "use cache"
  cacheTag(cacheTags.journalList)
  cacheLife("hours")
  return loadJournalCategories()
}

/** A post shows live product cards, so product changes refresh it too. */
export async function getJournalPost(slug: string) {
  "use cache"
  cacheTag(
    cacheTags.journalPost(slug),
    cacheTags.journalList,
    cacheTags.productsList,
  )
  cacheLife("hours")
  const post = await loadJournalPost(slug)
  if (!post) return null
  return { post, related: await loadRelatedPosts(post) }
}

/** The latest posts (30 for RSS; the sitemap asks for all of them). */
export async function getJournalFeed(limit = 30) {
  "use cache"
  cacheTag(cacheTags.journalList)
  cacheLife("hours")
  return loadJournalFeed(limit)
}

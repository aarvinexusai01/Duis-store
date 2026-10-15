import type { MetadataRoute } from "next"
import { connection } from "next/server"

import { getCatalogTree, getProductSitemap } from "@/features/catalog/queries"
import { pageHref } from "@/features/cms"
import { getPublishedPageList } from "@/features/cms/queries"
import { getPublishedCollections } from "@/features/collections/queries"
import { absoluteUrl } from "@/server/site-url"

/** Every indexable URL, built per request from cached reads (ADR-016). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  const [tree, products, collections, pages] = await Promise.all([
    getCatalogTree(),
    getProductSitemap(),
    getPublishedCollections(),
    getPublishedPageList(),
  ])
  const entry = (path: string, lastModified?: Date | null) => ({
    url: absoluteUrl(path),
    ...(lastModified ? { lastModified } : {}),
  })
  return [
    ...pages.map((page) => entry(pageHref(page.slug), page.publishedAt)),
    entry("/shop"),
    entry("/collections"),
    ...tree.departments.map((department) => entry(department.href)),
    ...tree.categories.filter((c) => !c.noindex).map((c) => entry(c.href)),
    ...collections
      .filter((c) => !c.noindex)
      .map((c) => entry(`/collections/${c.slug}`)),
    ...products.map((product) =>
      entry(`/products/${product.slug}`, product.updatedAt),
    ),
  ]
}

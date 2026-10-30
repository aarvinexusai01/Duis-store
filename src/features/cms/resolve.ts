import "server-only"
import { sql } from "drizzle-orm"

import {
  loadMediaRefs,
  loadNewestProductIds,
  loadProductCards,
  loadProductSlugs,
  loadRankedProductIds,
  type CatalogTree,
  type MediaRef,
  type ProductCard,
} from "@/features/catalog"
import {
  loadCollectionProductIds,
  loadCollectionsByIds,
  type CollectionSummary,
} from "@/features/collections"
import type { RichTextDocument } from "@/lib/rich-text"
import { getDb } from "@/server/db/client"
import { uuidArray } from "@/server/db/sql"

import type { Block } from "./blocks"
import type { NavigationData, NavItem, PageData } from "./schemas"
import { pageHref } from "@/lib/page-href"

/**
 * Turns stored CMS content (ids and slugs) into what the storefront renders
 * (hrefs, images, product cards). Anything that no longer resolves — an
 * archived product, a deleted image — is dropped rather than shown broken.
 */

export { pageHref }

export type ResolvedNavItem = {
  id: string
  label: string
  href: string
  badge?: string
  /** A promo image beside a top-level item's mega menu. */
  promo?: MediaRef
  children: ResolvedNavItem[]
}

export async function resolveNavigation(
  data: NavigationData,
  tree: CatalogTree,
): Promise<ResolvedNavItem[]> {
  const collectionIds: string[] = []
  const productIds: string[] = []
  const mediaIds: string[] = []
  const visit = (item: NavItem) => {
    if (item.promoMediaId) mediaIds.push(item.promoMediaId)
    if (item.link.type === "collection")
      collectionIds.push(item.link.collectionId)
    if (item.link.type === "product") productIds.push(item.link.productId)
    item.children?.forEach(visit)
  }
  data.items.forEach(visit)

  const [collections, products, media] = await Promise.all([
    loadCollectionsByIds(collectionIds),
    loadProductSlugs(productIds),
    loadMediaRefs(mediaIds),
  ])
  const categoryHref = new Map(tree.categories.map((c) => [c.id, c.href]))

  const resolve = (item: NavItem): ResolvedNavItem | null => {
    let href: string | undefined
    switch (item.link.type) {
      case "category":
        href = categoryHref.get(item.link.categoryId)
        break
      case "collection": {
        const collection = collections.get(item.link.collectionId)
        href = collection && `/collections/${collection.slug}`
        break
      }
      case "product": {
        const slug = products.get(item.link.productId)
        href = slug && `/products/${slug}`
        break
      }
      case "page":
        href = pageHref(item.link.slug)
        break
      case "url":
        href = item.link.href
        break
    }
    if (!href) return null
    return {
      id: item.id,
      label: item.label,
      href,
      ...(item.badge ? { badge: item.badge } : {}),
      ...(item.promoMediaId && media.get(item.promoMediaId)
        ? { promo: media.get(item.promoMediaId)! }
        : {}),
      children: (item.children ?? [])
        .map(resolve)
        .filter((child): child is ResolvedNavItem => child !== null),
    }
  }
  return data.items
    .map(resolve)
    .filter((item): item is ResolvedNavItem => item !== null)
}

// --- Page sections -------------------------------------------------------------

type Slide = {
  image: MediaRef
  mobileImage: MediaRef | null
  heading?: string
  subheading?: string
  cta?: { label: string; href: string }
  textTone: "light" | "dark"
}

export type ResolvedBlock =
  | { id: string; type: "hero_banner" | "promo_slider"; slides: Slide[] }
  | { id: string; type: "announcement"; text: string; href?: string }
  | {
      id: string
      type: "category_showcase"
      heading: string
      categories: { name: string; href: string; image: MediaRef | null }[]
    }
  | {
      id: string
      type: "featured_collections"
      heading: string
      layout: "grid" | "carousel" | "banner"
      collections: CollectionSummary[]
    }
  | {
      id: string
      type: "product_rail"
      heading: string
      products: ProductCard[]
      cta?: { label: string; href: string }
    }
  | {
      id: string
      type: "promo_banner_grid"
      banners: { image: MediaRef; heading?: string; href: string }[]
    }
  | { id: string; type: "rich_text"; content: RichTextDocument }
  | {
      id: string
      type: "brand_story"
      heading: string
      content: RichTextDocument
      image: MediaRef | null
      cta?: { label: string; href: string }
    }
  | { id: string; type: "newsletter"; heading: string; subheading?: string }
  | {
      id: string
      type: "faq_list"
      heading: string
      items: { question: string; answer: RichTextDocument }[]
    }
  | {
      id: string
      type: "image_with_text"
      heading: string
      content: RichTextDocument
      image: MediaRef
      imagePosition: "left" | "right"
      cta?: { label: string; href: string }
    }

/** Category image, or the newest in-stock product's image from its subtree. */
async function loadCategoryImages(
  categoryIds: string[],
): Promise<Map<string, MediaRef>> {
  if (categoryIds.length === 0) return new Map()
  const result = await getDb().execute<{
    id: string
    key: string
    width: number
    height: number
    alt: string
  }>(sql`
    select c.id, m.storage_key as key, m.width, m.height, m.alt_text as alt
    from categories c
    cross join lateral (
      select coalesce(c.image_media_id, (
        select lc.primary_media_id
        from product_categories pc
        join categories sub on sub.id = pc.category_id
        join products p on p.id = pc.product_id and p.status = 'active'
        join product_listing_cache lc on lc.product_id = p.id
        where sub.path <@ c.path and lc.primary_media_id is not null
        order by lc.in_stock desc, p.published_at desc
        limit 1
      )) as media_id
    ) chosen
    join media_assets m on m.id = chosen.media_id and m.deleted_at is null
    where c.id = any(${uuidArray(categoryIds)})
  `)
  return new Map(
    result.rows.map((row) => [
      row.id,
      { key: row.key, width: row.width, height: row.height, alt: row.alt },
    ]),
  )
}

async function railProducts(
  block: Extract<Block, { type: "product_rail" }>,
): Promise<ProductCard[]> {
  const { source, limit } = block
  switch (source.type) {
    case "collection":
      return loadProductCards(
        await loadCollectionProductIds(source.collectionId, limit),
      )
    case "products":
      return loadProductCards(source.productIds.slice(0, limit))
    case "new_arrivals":
      return loadProductCards(await loadNewestProductIds(limit))
    case "best_sellers":
      return loadProductCards(await loadRankedProductIds("best_selling", limit))
    case "trending":
      return loadProductCards(await loadRankedProductIds("trending", limit))
  }
}

export async function resolvePageBlocks(
  data: PageData,
  tree: CatalogTree,
): Promise<ResolvedBlock[]> {
  const sections = data.sections.filter((section) => section.enabled)

  const mediaIds = new Set<string>()
  const collectionIds = new Set<string>()
  const categoryIds = new Set<string>()
  for (const section of sections) {
    if (section.type === "hero_banner" || section.type === "promo_slider") {
      section.slides.forEach((slide) => {
        mediaIds.add(slide.mediaId)
        if (slide.mobileMediaId) mediaIds.add(slide.mobileMediaId)
      })
    }
    if (section.type === "promo_banner_grid")
      section.banners.forEach((banner) => mediaIds.add(banner.mediaId))
    if (section.type === "brand_story" && section.mediaId)
      mediaIds.add(section.mediaId)
    if (section.type === "image_with_text") mediaIds.add(section.mediaId)
    if (section.type === "featured_collections")
      section.collectionIds.forEach((id) => collectionIds.add(id))
    if (section.type === "category_showcase")
      section.categoryIds.forEach((id) => categoryIds.add(id))
  }

  const [media, collections, categoryImages] = await Promise.all([
    loadMediaRefs([...mediaIds]),
    loadCollectionsByIds([...collectionIds]),
    loadCategoryImages([...categoryIds]),
  ])
  const categories = new Map(tree.categories.map((c) => [c.id, c]))

  const resolved = await Promise.all(
    sections.map(async (section): Promise<ResolvedBlock | null> => {
      switch (section.type) {
        case "hero_banner":
        case "promo_slider": {
          const slides = section.slides.flatMap((slide) => {
            const image = media.get(slide.mediaId)
            if (!image) return []
            return [
              {
                image,
                mobileImage: slide.mobileMediaId
                  ? (media.get(slide.mobileMediaId) ?? null)
                  : null,
                heading: slide.heading,
                subheading: slide.subheading,
                cta: slide.cta,
                textTone: slide.textTone,
              },
            ]
          })
          return slides.length > 0
            ? { id: section.id, type: section.type, slides }
            : null
        }
        case "announcement":
          return {
            id: section.id,
            type: "announcement",
            text: section.text,
            href: section.href,
          }
        case "category_showcase": {
          const items = section.categoryIds.flatMap((id) => {
            const category = categories.get(id)
            return category
              ? [
                  {
                    name: category.name,
                    href: category.href,
                    image: categoryImages.get(id) ?? null,
                  },
                ]
              : []
          })
          return items.length > 0
            ? {
                id: section.id,
                type: "category_showcase",
                heading: section.heading,
                categories: items,
              }
            : null
        }
        case "featured_collections": {
          const items = section.collectionIds.flatMap((id) => {
            const collection = collections.get(id)
            return collection ? [collection] : []
          })
          return items.length > 0
            ? {
                id: section.id,
                type: "featured_collections",
                heading: section.heading,
                layout: section.layout,
                collections: items,
              }
            : null
        }
        case "product_rail": {
          const products = await railProducts(section)
          return products.length > 0
            ? {
                id: section.id,
                type: "product_rail",
                heading: section.heading,
                products,
                cta: section.cta,
              }
            : null
        }
        case "promo_banner_grid": {
          const banners = section.banners.flatMap((banner) => {
            const image = media.get(banner.mediaId)
            return image
              ? [{ image, heading: banner.heading, href: banner.href }]
              : []
          })
          return banners.length > 0
            ? { id: section.id, type: "promo_banner_grid", banners }
            : null
        }
        case "rich_text":
          return { id: section.id, type: "rich_text", content: section.content }
        case "brand_story":
          return {
            id: section.id,
            type: "brand_story",
            heading: section.heading,
            content: section.content,
            image: section.mediaId
              ? (media.get(section.mediaId) ?? null)
              : null,
            cta: section.cta,
          }
        case "newsletter":
          return {
            id: section.id,
            type: "newsletter",
            heading: section.heading,
            subheading: section.subheading,
          }
        case "faq_list":
          return {
            id: section.id,
            type: "faq_list",
            heading: section.heading,
            items: section.items,
          }
        case "image_with_text": {
          const image = media.get(section.mediaId)
          return image
            ? {
                id: section.id,
                type: "image_with_text",
                heading: section.heading,
                content: section.content,
                image,
                imagePosition: section.imagePosition,
                cta: section.cta,
              }
            : null
        }
      }
    }),
  )
  return resolved.filter((block): block is ResolvedBlock => block !== null)
}

import { z } from "zod"

import { richTextSchema } from "@/lib/rich-text"

/**
 * Homepage and landing-page sections (doc/04 §4). Each block is plain,
 * validated data; the storefront renders it with its own components (Phase 2)
 * and nothing in a block is ever executed or injected as HTML.
 */

// Internal paths ("/collections/new") or https links only.
export const safeHref = z
  .string()
  .max(500)
  .regex(
    /^(\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/,
    "Use a site path like /shop or an https link.",
  )

const link = z.object({
  label: z.string().trim().min(1).max(40),
  href: safeHref,
})
const id = z.uuid()
const heading = z.string().trim().min(1).max(80)

const slide = z.object({
  mediaId: id,
  mobileMediaId: id.optional(),
  heading: z.string().trim().max(80).optional(),
  subheading: z.string().trim().max(160).optional(),
  cta: link.optional(),
  textTone: z.enum(["light", "dark"]).default("light"),
})

const productSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("collection"), collectionId: id }),
  z.object({
    type: z.literal("products"),
    productIds: z.array(id).min(1).max(24),
  }),
  z.object({ type: z.literal("new_arrivals") }),
  z.object({ type: z.literal("best_sellers") }),
  z.object({ type: z.literal("trending") }),
])

const base = {
  id: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
}

export const blockSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("hero_banner"),
    slides: z.array(slide).min(1).max(6),
  }),
  z.object({
    ...base,
    type: z.literal("promo_slider"),
    slides: z.array(slide).min(1).max(10),
  }),
  z.object({
    ...base,
    type: z.literal("announcement"),
    text: z.string().trim().min(1).max(140),
    href: safeHref.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("category_showcase"),
    heading,
    categoryIds: z.array(id).min(1).max(12),
  }),
  z.object({
    ...base,
    type: z.literal("featured_collections"),
    heading,
    collectionIds: z.array(id).min(1).max(8),
    layout: z.enum(["grid", "carousel", "banner"]).default("grid"),
  }),
  z.object({
    ...base,
    type: z.literal("product_rail"),
    heading,
    source: productSource,
    limit: z.number().int().min(4).max(24).default(12),
    cta: link.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("promo_banner_grid"),
    banners: z
      .array(
        z.object({
          mediaId: id,
          heading: z.string().trim().max(60).optional(),
          href: safeHref,
        }),
      )
      .min(1)
      .max(4),
  }),
  z.object({ ...base, type: z.literal("rich_text"), content: richTextSchema }),
  z.object({
    ...base,
    type: z.literal("brand_story"),
    heading,
    content: richTextSchema,
    mediaId: id.optional(),
    cta: link.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("newsletter"),
    heading,
    subheading: z.string().trim().max(160).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("faq_list"),
    heading,
    items: z
      .array(
        z.object({
          question: z.string().trim().min(1).max(200),
          answer: richTextSchema,
        }),
      )
      .min(1)
      .max(40),
  }),
  z.object({
    ...base,
    type: z.literal("image_with_text"),
    mediaId: id,
    heading,
    content: richTextSchema,
    cta: link.optional(),
    imagePosition: z.enum(["left", "right"]).default("left"),
  }),
])

export type Block = z.infer<typeof blockSchema>
export type BlockType = Block["type"]

export type ContentRefs = {
  productIds: Set<string>
  collectionIds: Set<string>
  categoryIds: Set<string>
  mediaIds: Set<string>
}

export function emptyRefs(): ContentRefs {
  return {
    productIds: new Set(),
    collectionIds: new Set(),
    categoryIds: new Set(),
    mediaIds: new Set(),
  }
}

/** Everything a block points at, for cms_revision_refs. */
export function collectBlockRefs(block: Block, refs: ContentRefs): void {
  switch (block.type) {
    case "hero_banner":
    case "promo_slider":
      for (const s of block.slides) {
        refs.mediaIds.add(s.mediaId)
        if (s.mobileMediaId) refs.mediaIds.add(s.mobileMediaId)
      }
      return
    case "category_showcase":
      block.categoryIds.forEach((value) => refs.categoryIds.add(value))
      return
    case "featured_collections":
      block.collectionIds.forEach((value) => refs.collectionIds.add(value))
      return
    case "product_rail":
      if (block.source.type === "collection")
        refs.collectionIds.add(block.source.collectionId)
      if (block.source.type === "products")
        block.source.productIds.forEach((value) => refs.productIds.add(value))
      return
    case "promo_banner_grid":
      block.banners.forEach((banner) => refs.mediaIds.add(banner.mediaId))
      return
    case "brand_story":
      if (block.mediaId) refs.mediaIds.add(block.mediaId)
      return
    case "image_with_text":
      refs.mediaIds.add(block.mediaId)
      return
    default:
      return
  }
}

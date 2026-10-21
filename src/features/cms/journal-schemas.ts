import { z } from "zod"

import { richTextSchema, richTextToPlainText } from "@/lib/rich-text"

import { safeHref } from "./blocks"

/**
 * Journal posts (doc/06 Phase 6c, owner decisions 2026-10-21): a body of
 * blocks. Text uses the shared rich-text subset; images, shoppable products
 * and allow-listed embeds sit between text blocks. Safe for the client.
 */

const id = z.uuid()
const blockId = z.string().min(1).max(64)

export const YOUTUBE_ID = /^[\w-]{11}$/
export const INSTAGRAM_URL =
  /^https:\/\/www\.instagram\.com\/(p|reel)\/[\w-]{5,40}\/?$/

export const postBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: blockId, type: z.literal("text"), content: richTextSchema }),
  z.object({
    id: blockId,
    type: z.literal("image"),
    mediaId: id,
    caption: z.string().trim().max(200).optional(),
  }),
  z.object({
    id: blockId,
    type: z.literal("products"),
    heading: z.string().trim().max(80).optional(),
    productIds: z.array(id).min(1, "Add at least one product.").max(8),
  }),
  z.object({
    id: blockId,
    type: z.literal("youtube"),
    videoId: z.string().regex(YOUTUBE_ID, "Paste a YouTube video link."),
    title: z.string().trim().max(120).optional(),
  }),
  z.object({
    id: blockId,
    type: z.literal("instagram"),
    url: z
      .string()
      .regex(INSTAGRAM_URL, "Paste an Instagram post or reel link."),
  }),
])
export type PostBlock = z.infer<typeof postBlockSchema>
export type PostBlockType = PostBlock["type"]

export const blogPostDataSchema = z.object({
  title: z.string().trim().min(1, "Give the post a title.").max(140),
  excerpt: z.string().trim().max(300).optional(),
  coverMediaId: id.optional(),
  authorId: id,
  categoryId: id.optional(),
  tagIds: z.array(id).max(10).default([]),
  body: z
    .array(postBlockSchema)
    .max(60)
    .refine(
      (blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length,
      "Every block needs a unique id.",
    ),
  seo: z
    .object({
      title: z.string().max(70).optional(),
      description: z.string().max(170).optional(),
      ogMediaId: id.optional(),
      noindex: z.boolean().optional(),
      canonical: safeHref.optional(),
    })
    .default({}),
})
export type BlogPostData = z.infer<typeof blogPostDataSchema>

/** The video ID from a YouTube watch, share, shorts or embed link. */
export function youtubeId(input: string): string | null {
  const text = input.trim()
  if (YOUTUBE_ID.test(text)) return text
  try {
    const url = new URL(text)
    const host = url.hostname.replace(/^www\.|^m\./, "")
    let candidate: string | null = null
    if (host === "youtu.be") candidate = url.pathname.slice(1)
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      candidate =
        url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ??
        null
    }
    return candidate && YOUTUBE_ID.test(candidate) ? candidate : null
  } catch {
    return null
  }
}

/** An Instagram post or reel link in its canonical form, or null. */
export function instagramUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (!/^(www\.)?instagram\.com$/.test(url.hostname)) return null
    const match = url.pathname.match(/^\/(p|reel)\/([\w-]{5,40})/)
    return match ? `https://www.instagram.com/${match[1]}/${match[2]}/` : null
  } catch {
    return null
  }
}

/** About 200 words a minute, at least one. */
export function readingMinutes(data: Pick<BlogPostData, "body">): number {
  const words = data.body
    .filter((block) => block.type === "text")
    .map((block) => richTextToPlainText(block.content))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

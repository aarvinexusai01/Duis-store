import { z } from "zod"

/**
 * Rich text is stored as the ProseMirror/Tiptap JSON subset below — never as
 * HTML — and rendered through an allow-list (doc/08 §2, XSS). Anything outside
 * the subset fails validation.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i

const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({
    type: z.literal("link"),
    attrs: z.object({ href: z.string().max(2048).regex(SAFE_HREF) }),
  }),
])

const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(10_000),
  marks: z.array(markSchema).max(6).optional(),
})
const hardBreak = z.object({ type: z.literal("hardBreak") })
const inline = z.union([textNode, hardBreak])

export type RichTextMark = z.infer<typeof markSchema>
export type RichTextInline = z.infer<typeof inline>

export type RichTextBlock =
  | { type: "paragraph"; content?: RichTextInline[] }
  | { type: "heading"; attrs: { level: 2 | 3 | 4 }; content?: RichTextInline[] }
  | { type: "bulletList" | "orderedList"; content: RichTextListItem[] }
  | { type: "blockquote"; content: RichTextBlock[] }
  | { type: "horizontalRule" }

export type RichTextListItem = { type: "listItem"; content: RichTextBlock[] }

export type RichTextDocument = { type: "doc"; content: RichTextBlock[] }

const blockSchema: z.ZodType<RichTextBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("paragraph"),
      content: z.array(inline).max(500).optional(),
    }),
    z.object({
      type: z.literal("heading"),
      attrs: z.object({
        level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      }),
      content: z.array(inline).max(200).optional(),
    }),
    z.object({
      type: z.enum(["bulletList", "orderedList"]),
      content: z.array(listItemSchema).min(1).max(100),
    }),
    z.object({
      type: z.literal("blockquote"),
      content: z.array(blockSchema).min(1).max(50),
    }),
    z.object({ type: z.literal("horizontalRule") }),
  ]),
)

const listItemSchema: z.ZodType<RichTextListItem> = z.lazy(() =>
  z.object({
    type: z.literal("listItem"),
    content: z.array(blockSchema).min(1).max(20),
  }),
)

export const richTextSchema: z.ZodType<RichTextDocument> = z.object({
  type: z.literal("doc"),
  content: z.array(blockSchema).max(500),
})

/** Builds a document of plain paragraphs (seed data, simple descriptions). */
export function paragraphs(...texts: string[]): RichTextDocument {
  return {
    type: "doc",
    content: texts.map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : undefined,
    })),
  }
}

/** Plain text for search vectors, meta descriptions and email previews. */
export function richTextToPlainText(
  doc: RichTextDocument | null | undefined,
): string {
  if (!doc) return ""
  const parts: string[] = []
  const visit = (node: RichTextBlock | RichTextListItem | RichTextInline) => {
    switch (node.type) {
      case "text":
        parts.push(node.text)
        return
      case "hardBreak":
        parts.push(" ")
        return
      case "horizontalRule":
        return
      case "paragraph":
      case "heading":
        node.content?.forEach(visit)
        parts.push("\n")
        return
      default:
        node.content.forEach(visit)
    }
  }
  doc.content.forEach(visit)
  return parts
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim()
}

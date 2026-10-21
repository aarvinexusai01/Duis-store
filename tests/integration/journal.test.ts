import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import {
  getEditor,
  loadJournalFeed,
  loadPreview,
  publishScheduled,
  type BlogPostData,
} from "@/features/cms"
import { loadJournalList, loadJournalPost } from "@/features/cms/journal"
import {
  changePostSlug,
  createPost,
  createTag,
  deleteJournalTerm,
  saveAuthor,
  saveCategory,
  unpublishPost,
} from "@/features/cms/journal-admin"
import {
  autosaveDraft,
  createPreviewLink,
  publishDraft,
  scheduleDraft,
} from "@/features/cms/workflow"
import { paragraphs } from "@/lib/rich-text"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { createUserActor, unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { code, sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

let manager: Actor
let editor: Actor
let authorId: string
let categoryId: string
let categorySlug: string
let tagId: string
let productId: string

async function base(id: string) {
  const state = await getEditor(manager, { target: { type: "blog_post", id } })
  return state.draft
    ? { revisionId: state.draft.revisionId, updatedAt: state.draft.updatedAt }
    : null
}

async function writePost(
  actor: Actor,
  data: Partial<BlogPostData> = {},
): Promise<{
  id: string
  slug: string
  target: { type: "blog_post"; id: string }
}> {
  const slug = unique("story")
  const { id } = await createPost(actor, {
    title: "Monsoon Layers",
    slug,
    authorId,
  })
  const target = { type: "blog_post" as const, id }
  await autosaveDraft(actor, {
    target,
    data: {
      title: "Monsoon Layers",
      excerpt: "How to dress for the rain.",
      authorId,
      categoryId,
      tagIds: [tagId],
      body: [
        {
          id: "intro",
          type: "text",
          content: paragraphs(
            Array.from({ length: 450 }, () => "rain").join(" "),
          ),
        },
        { id: "shop", type: "products", productIds: [productId] },
        { id: "video", type: "youtube", videoId: "dQw4w9WgXcQ" },
      ],
      seo: {},
      ...data,
    },
    base: await base(id),
  })
  return { id, slug, target }
}

beforeAll(async () => {
  manager = await createUserActor("content_manager")
  editor = await createUserActor("content_editor")
  ;({ id: authorId } = await saveAuthor(manager, {
    name: "Aarav",
    slug: unique("aarav"),
    bio: "Stylist.",
  }))
  categorySlug = unique("style")
  ;({ id: categoryId } = await saveCategory(manager, {
    name: "Style notes",
    slug: categorySlug,
  }))
  ;({ id: tagId } = await createTag(editor, {
    name: "Monsoon",
    slug: unique("monsoon"),
  }))
  ;({ productId } = await sellableProduct())
})

describe("the journal", () => {
  it("editors write, managers publish, readers see it with live products", async () => {
    const post = await writePost(editor)
    expect(await code(publishDraft(editor, { target: post.target }))).toBe(
      "FORBIDDEN",
    )
    expect(await loadJournalPost(post.slug)).toBeNull()

    await publishDraft(manager, { target: post.target })
    const live = await loadJournalPost(post.slug)
    expect(live).toMatchObject({
      title: "Monsoon Layers",
      readingMinutes: 2,
      author: { name: "Aarav" },
      category: { name: "Style notes", slug: categorySlug },
      tags: [{ name: "Monsoon" }],
      authorProfile: { bio: "Stylist." },
    })
    expect(live!.body.map((b) => b.type)).toEqual([
      "text",
      "products",
      "youtube",
    ])
    const shop = live!.body[1]
    expect(shop?.type === "products" && shop.products[0]?.id).toBe(productId)

    const inCategory = await loadJournalList({
      kind: "category",
      slug: categorySlug,
    })
    expect(inCategory.posts.map((p) => p.slug)).toContain(post.slug)
    expect((await loadJournalFeed()).map((p) => p.slug)).toContain(post.slug)

    const jobs = await getDb().execute(sql`
      select 1 from pgboss.job where name = 'cache.revalidate'
        and data->'tags' ? ${`journal:post:${post.slug}`}`)
    expect(jobs.rows.length).toBeGreaterThan(0)
  })

  it("keeps the first publication date and redirects a changed address", async () => {
    const post = await writePost(manager)
    await publishDraft(manager, { target: post.target })
    const first = (await loadJournalPost(post.slug))!.publishedAt
    await autosaveDraft(manager, {
      target: post.target,
      data: {
        title: "Monsoon Layers, updated",
        authorId,
        tagIds: [],
        body: [],
        seo: {},
      },
      base: await base(post.id),
    })
    await publishDraft(manager, { target: post.target })
    const updated = (await loadJournalPost(post.slug))!
    expect(updated.title).toBe("Monsoon Layers, updated")
    expect(updated.publishedAt).toEqual(first)
    expect(updated.tags).toEqual([])

    const newSlug = unique("story")
    await changePostSlug(manager, { postId: post.id, slug: newSlug })
    const redirect = await getDb().execute<{ to_path: string }>(sql`
      select to_path from redirects where from_path = ${`/journal/${post.slug}`}`)
    expect(redirect.rows[0]?.to_path).toBe(`/journal/${newSlug}`)

    await unpublishPost(manager, { postId: post.id })
    expect(await loadJournalPost(newSlug)).toBeNull()
  })

  it("keeps hidden posts out of the feed and checks embeds", async () => {
    const post = await writePost(manager, { seo: { noindex: true } })
    await publishDraft(manager, { target: post.target })
    expect((await loadJournalFeed()).map((p) => p.slug)).not.toContain(
      post.slug,
    )

    for (const block of [
      { id: "v", type: "youtube", videoId: "not a video" },
      { id: "i", type: "instagram", url: "https://evil.example/p/abc12" },
    ]) {
      expect(
        await code(
          autosaveDraft(manager, {
            target: post.target,
            data: { title: "x", authorId, tagIds: [], body: [block], seo: {} },
            base: await base(post.id),
          }),
        ),
      ).toBe("VALIDATION_FAILED")
    }
  })

  it("previews a draft and publishes on schedule", async () => {
    const post = await writePost(editor)
    const state = await getEditor(editor, { target: post.target })
    const { path } = await createPreviewLink(editor, {
      revisionId: state.draft!.revisionId,
    })
    const preview = await loadPreview(path.replace("/preview/", ""))
    expect(preview).toMatchObject({ kind: "blog_post", slug: post.slug })

    const at = new Date(Date.now() + 5 * 60_000)
    await scheduleDraft(manager, { target: post.target, at: at.toISOString() })
    await publishScheduled(new Date(at.getTime() + 1_000))
    expect((await loadJournalPost(post.slug))?.title).toBe("Monsoon Layers")
  })

  it("won't delete an author, category or tag a story uses", async () => {
    expect(
      await code(deleteJournalTerm(manager, { kind: "author", id: authorId })),
    ).toBe("CONFLICT")
    expect(
      await code(deleteJournalTerm(manager, { kind: "tag", id: tagId })),
    ).toBe("CONFLICT")
    expect(
      await code(deleteJournalTerm(editor, { kind: "tag", id: tagId })),
    ).toBe("FORBIDDEN")
    const { id: spare } = await saveCategory(manager, {
      name: "Spare",
      slug: unique("spare"),
    })
    await deleteJournalTerm(manager, { kind: "category", id: spare })
  })
})

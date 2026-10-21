import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { moveCategory, updateCategory, updateProduct } from "@/features/catalog"
import {
  createPage,
  getEditor,
  loadPreview,
  loadPublishedNavigation,
  loadPublishedSiteSettings,
  type NavigationData,
  type SiteSettingsData,
} from "@/features/cms"
import { changePageSlug } from "@/features/cms/pages-admin"
import {
  autosaveDraft,
  createPreviewLink,
  publishDraft,
} from "@/features/cms/workflow"
import {
  archiveCollection,
  createCollection,
  publishCollection,
  updateCollection,
} from "@/features/collections"
import {
  adminListMedia,
  deleteMedia,
  getMediaUsage,
  uploadImage,
} from "@/features/media"
import {
  adminListRedirects,
  createRedirect,
  deleteRedirect,
} from "@/features/redirects"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { asSystem, createUserActor, unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"
import { code, sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

let manager: Actor
let editor: Actor

async function redirectFor(from: string) {
  const found = await getDb().execute<{ to_path: string; source: string }>(
    sql`select to_path, source from redirects where from_path = ${from}`,
  )
  return found.rows[0] ?? null
}

async function base(target: Parameters<typeof getEditor>[1]["target"]) {
  const state = await getEditor(manager, { target })
  return state.draft
    ? { revisionId: state.draft.revisionId, updatedAt: state.draft.updatedAt }
    : null
}

/** A published landing page whose content is `data`. */
async function livePage(data: unknown) {
  const slug = unique("drop")
  const { id } = await createPage(manager, {
    type: "landing",
    slug,
    title: "Drop",
  })
  const target = { type: "page" as const, id }
  await autosaveDraft(manager, { target, data, base: null })
  await publishDraft(manager, { target })
  return { id, slug, target }
}

beforeAll(async () => {
  manager = await createUserActor("content_manager")
  editor = await createUserActor("content_editor")
})

describe("menus and site settings share the page workflow", () => {
  it("drafts, previews and publishes the footer menu", async () => {
    const target = { type: "navigation" as const, key: "footer" as const }
    const data: NavigationData = {
      items: [
        {
          id: "help",
          label: "Help",
          link: { type: "url", href: "/contact" },
          children: [
            { id: "faq", label: "FAQ", link: { type: "url", href: "/faq" } },
          ],
        },
      ],
    }
    const saved = await autosaveDraft(editor, {
      target,
      data,
      base: await base(target),
    })
    expect(await code(publishDraft(editor, { target }))).toBe("FORBIDDEN")

    const { path } = await createPreviewLink(editor, {
      revisionId: saved.revisionId,
    })
    const preview = await loadPreview(path.replace("/preview/", ""))
    expect(preview).toMatchObject({ kind: "navigation", key: "footer", data })

    await publishDraft(manager, { target })
    expect(await loadPublishedNavigation("footer")).toEqual(data)
  })

  it("checks site settings before saving them", async () => {
    const target = { type: "site_settings" as const }
    const current = (await getEditor(manager, { target }))
      .data as SiteSettingsData
    expect(
      await code(
        autosaveDraft(manager, {
          target,
          data: { ...current, contact: { email: "not an email" } },
          base: await base(target),
        }),
      ),
    ).toBe("VALIDATION_FAILED")

    const next: SiteSettingsData = {
      brandName: "Duis",
      contact: { email: "hello@duis.test" },
      social: {},
      announcement: { enabled: true, text: "Monsoon drop is live" },
      defaultSeo: { title: "Duis", description: "Streetwear from India." },
    }
    await autosaveDraft(manager, {
      target,
      data: next,
      base: await base(target),
    })
    await publishDraft(manager, { target })
    expect((await loadPublishedSiteSettings())?.announcement?.text).toBe(
      "Monsoon drop is live",
    )
  })
})

describe("redirects", () => {
  it("follow a live page's address changes without chains", async () => {
    const page = await livePage({ sections: [], seo: {} })
    const second = unique("drop")
    await changePageSlug(manager, { pageId: page.id, slug: second })
    expect(await redirectFor(`/pages/${page.slug}`)).toEqual({
      to_path: `/pages/${second}`,
      source: "auto",
    })
    const third = unique("drop")
    await changePageSlug(manager, { pageId: page.id, slug: third })
    // The first address now goes straight to the newest one.
    expect((await redirectFor(`/pages/${page.slug}`))?.to_path).toBe(
      `/pages/${third}`,
    )
    expect((await redirectFor(`/pages/${second}`))?.to_path).toBe(
      `/pages/${third}`,
    )

    // New content at an old address takes it back.
    await createPage(manager, {
      type: "landing",
      slug: page.slug,
      title: "Again",
    })
    expect(await redirectFor(`/pages/${page.slug}`)).toBeNull()

    expect(
      await code(
        changePageSlug(editor, { pageId: page.id, slug: unique("x") }),
      ),
    ).toBe("FORBIDDEN")
  })

  it("follow live products, collections and categories", async () => {
    const product = await sellableProduct()
    const productSlug = unique("tee")
    const { rows } = await getDb().execute<{ slug: string }>(
      sql`select slug::text from products where id = ${product.productId}`,
    )
    await updateProduct(asSystem(), {
      id: product.productId,
      slug: productSlug,
    })
    expect((await redirectFor(`/products/${rows[0]!.slug}`))?.to_path).toBe(
      `/products/${productSlug}`,
    )

    const collection = await createCollection(asSystem(), {
      type: "manual",
      slug: unique("edit"),
      title: "Edit",
    })
    const { rows: before } = await getDb().execute<{ slug: string }>(
      sql`select slug::text from collections where id = ${collection.id}`,
    )
    // Never live: no redirect needed.
    const draftSlug = unique("edit")
    await updateCollection(asSystem(), { id: collection.id, slug: draftSlug })
    expect(await redirectFor(`/collections/${before[0]!.slug}`)).toBeNull()
    await publishCollection(asSystem(), { id: collection.id })
    const liveSlug = unique("edit")
    await updateCollection(asSystem(), { id: collection.id, slug: liveSlug })
    expect((await redirectFor(`/collections/${draftSlug}`))?.to_path).toBe(
      `/collections/${liveSlug}`,
    )

    // Moving a category changes its address and its children's.
    const href = async (id: string) => {
      const found = await getDb().execute<{ slug: string; path: string }>(
        sql`select slug::text, path::text from categories where id = ${id}`,
      )
      return found.rows[0]!
    }
    const oversized = await href(product.oversizedId)
    await updateCategory(asSystem(), {
      id: product.oversizedId,
      slug: unique("big"),
    })
    const redirects = await getDb().execute<{ from_path: string }>(sql`
      select from_path from redirects where from_path like ${`%/${oversized.slug}`}`)
    expect(redirects.rows.length).toBeGreaterThan(0)
    await moveCategory(asSystem(), { id: product.oversizedId, parentId: null })
    const after = await getDb().execute<{ n: number }>(sql`
      select count(*)::int as n from redirects where from_path like ${`%/${oversized.slug}`}`)
    expect(after.rows[0]!.n).toBeGreaterThan(0)
  })

  it("are managed by staff, without loops or reserved areas", async () => {
    const from = `/${unique("sale")}`
    const { id } = await createRedirect(manager, {
      fromPath: from.toUpperCase(),
      toPath: "/collections/summer",
      permanent: true,
    })
    expect((await redirectFor(from))?.to_path).toBe("/collections/summer")
    expect(
      await code(
        createRedirect(manager, {
          fromPath: from,
          toPath: "/x",
          permanent: true,
        }),
      ),
    ).toBe("CONFLICT")
    expect(
      await code(
        createRedirect(manager, {
          fromPath: "/collections/summer",
          toPath: from,
          permanent: true,
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    expect(
      await code(
        createRedirect(manager, {
          fromPath: "/admin/orders",
          toPath: "/",
          permanent: true,
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    expect(
      await code(
        createRedirect(editor, {
          fromPath: "/a-b",
          toPath: "/",
          permanent: true,
        }),
      ),
    ).toBe("FORBIDDEN")
    const listed = await adminListRedirects(editor, { q: from })
    expect(listed.rows.map((r) => r.id)).toEqual([id])
    await deleteRedirect(manager, { id })
    expect(await redirectFor(from)).toBeNull()
  })
})

describe("in-use content", () => {
  it("blocks archiving a collection a live page uses, naming the page", async () => {
    const collection = await createCollection(asSystem(), {
      type: "manual",
      slug: unique("used"),
      title: "Used",
    })
    const page = await livePage({
      sections: [
        {
          id: "rail",
          type: "featured_collections",
          enabled: true,
          heading: "Shop",
          collectionIds: [collection.id],
          layout: "grid",
        },
      ],
      seo: {},
    })
    const error = await archiveCollection(asSystem(), {
      id: collection.id,
    }).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/Page "Drop"/)

    await autosaveDraft(manager, {
      target: page.target,
      data: { sections: [], seo: {} },
      base: await base(page.target),
    })
    await publishDraft(manager, { target: page.target })
    await archiveCollection(asSystem(), { id: collection.id })
  })

  it("lists where an image is used and refuses to delete it", async () => {
    const image = await uploadImage(asSystem(), {
      bytes: await makeUniqueImage(),
      altText: "Monsoon",
    })
    const unused = await adminListMedia(editor, {
      q: "Monsoon",
      filter: "unused",
    })
    expect(unused.items.map((m) => m.id)).toContain(image.id)

    await livePage({
      sections: [
        {
          id: "story",
          type: "image_with_text",
          enabled: true,
          mediaId: image.id,
          heading: "Rain ready",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          imagePosition: "left",
        },
      ],
      seo: {},
    })
    const { usage } = await getMediaUsage(editor, { id: image.id })
    expect(usage).toEqual([
      expect.objectContaining({ kind: "Page", label: "Drop" }),
    ])
    const error = await deleteMedia(manager, { id: image.id }).catch(
      (e: Error) => e,
    )
    expect((error as Error).message).toMatch(/used by Page "Drop"/)
    const listed = await adminListMedia(editor, { q: "Monsoon" })
    expect(listed.items.find((m) => m.id === image.id)?.used).toBe(true)
  })
})

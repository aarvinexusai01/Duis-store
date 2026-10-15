import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { cmsRevisionRefs, cmsRevisions, collections } from "@/db/schema"
import {
  createPage,
  loadPublishedNavigation,
  loadPublishedPage,
  loadPublishedSiteSettings,
  publishRevision,
  saveNavigationDraft,
  savePageDraft,
  saveSiteSettingsDraft,
  type PageData,
} from "@/features/cms"
import { createCollection } from "@/features/collections"
import { uploadImage } from "@/features/media"
import { paragraphs } from "@/lib/rich-text"
import { getDb } from "@/server/db/client"

import { asSystem, createUserActor, unique } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"

closeConnectionsAfterAll()

const system = asSystem()

async function homepageData(): Promise<{
  data: PageData
  collectionId: string
  productId: string
  mediaId: string
}> {
  const fx = await createProductFixture()
  const hero = await uploadImage(system, {
    bytes: await makeUniqueImage(1600, 900),
  })
  const collection = await createCollection(system, {
    type: "manual",
    slug: unique("drop"),
    title: "The Drop",
  })
  return {
    collectionId: collection.id,
    productId: fx.productId,
    mediaId: hero.id,
    data: {
      sections: [
        {
          id: "hero",
          type: "hero_banner",
          enabled: true,
          slides: [
            {
              mediaId: hero.id,
              heading: "New drop",
              textTone: "light",
              cta: { label: "Shop now", href: "/collections/drop" },
            },
          ],
        },
        {
          id: "featured",
          type: "featured_collections",
          enabled: true,
          heading: "Featured",
          collectionIds: [collection.id],
          layout: "grid",
        },
        {
          id: "rail",
          type: "product_rail",
          enabled: true,
          heading: "Picked for you",
          source: { type: "products", productIds: [fx.productId] },
          limit: 12,
        },
        {
          id: "story",
          type: "brand_story",
          enabled: true,
          heading: "Made loud",
          content: paragraphs("Built in Mumbai."),
        },
      ],
      seo: { title: "Duis" },
    },
  }
}

describe("pages", () => {
  it("validates blocks and refuses unsafe links", async () => {
    const page = await createPage(system, {
      type: "landing",
      slug: unique("sale"),
      title: "Sale",
    })
    const bad = await savePageDraft(system, {
      pageId: page.id,
      data: {
        sections: [
          {
            id: "x",
            type: "announcement",
            text: "Hi",
            href: "javascript:alert(1)",
          },
        ],
      } as never,
    }).catch((err) => err)
    expect(bad).toMatchObject({ code: "VALIDATION_FAILED" })
  })

  it("indexes references, publishes, and serves only the published revision", async () => {
    const { data, collectionId, productId, mediaId } = await homepageData()
    const slug = unique("home")
    const page = await createPage(system, { type: "home", slug, title: "Home" })
    const draft = await savePageDraft(system, { pageId: page.id, data })

    const refs = await getDb()
      .select()
      .from(cmsRevisionRefs)
      .where(eq(cmsRevisionRefs.revisionId, draft.revisionId))
    expect(
      refs
        .map((ref) => ref.collectionId ?? ref.productId ?? ref.mediaId)
        .sort(),
    ).toEqual([collectionId, productId, mediaId].sort())

    expect(await loadPublishedPage(slug)).toBeNull()
    await publishRevision(system, { revisionId: draft.revisionId })
    expect(
      await publishRevision(system, { revisionId: draft.revisionId }),
    ).toMatchObject({ alreadyPublished: true })
    expect(
      (await loadPublishedPage(slug))?.data.sections.map((s) => s.id),
    ).toEqual(["hero", "featured", "rail", "story"])

    // A new draft does not change the live page until it is published.
    const next = await savePageDraft(system, {
      pageId: page.id,
      data: { ...data, sections: data.sections.slice(0, 1) },
    })
    expect((await loadPublishedPage(slug))?.data.sections).toHaveLength(4)
    await publishRevision(system, { revisionId: next.revisionId })
    expect((await loadPublishedPage(slug))?.data.sections).toHaveLength(1)

    const [first] = await getDb()
      .select()
      .from(cmsRevisions)
      .where(eq(cmsRevisions.id, draft.revisionId))
    expect(first!.workflowStatus).toBe("archived")
  })

  it("protects referenced content from deletion", async () => {
    const { data, collectionId } = await homepageData()
    const page = await createPage(system, {
      type: "landing",
      slug: unique("lp"),
      title: "LP",
    })
    await savePageDraft(system, { pageId: page.id, data })
    await expect(
      getDb().delete(collections).where(eq(collections.id, collectionId)),
    ).rejects.toThrow()
  })

  it("lets editors draft but not publish", async () => {
    const editor = await createUserActor("content_editor")
    const page = await createPage(editor, {
      type: "static",
      slug: unique("about"),
      title: "About",
    })
    const draft = await savePageDraft(editor, {
      pageId: page.id,
      data: {
        sections: [
          {
            id: "body",
            type: "rich_text",
            enabled: true,
            content: paragraphs("Hello"),
          },
        ],
        seo: {},
      },
    })
    await expect(
      publishRevision(editor, { revisionId: draft.revisionId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
})

describe("navigation and site settings", () => {
  it("publishes menus and settings", async () => {
    const fx = await createProductFixture()
    const menu = await saveNavigationDraft(system, {
      key: "header",
      data: {
        items: [
          {
            id: "men",
            label: "Men",
            link: { type: "category", categoryId: fx.teesId },
            children: [
              {
                id: "oversized",
                label: "Oversized",
                link: { type: "category", categoryId: fx.oversizedId },
                badge: "Hot",
              },
            ],
          },
          {
            id: "about",
            label: "About",
            link: { type: "page", slug: "about" },
          },
        ],
      },
    })
    await publishRevision(system, { revisionId: menu.revisionId })
    expect(
      (await loadPublishedNavigation("header"))?.items[0]?.children?.[0]?.label,
    ).toBe("Oversized")

    const settings = await saveSiteSettingsDraft(system, {
      data: {
        brandName: "Duis",
        contact: { email: "support@duis.test" },
        defaultSeo: {
          title: "Duis — Men's Streetwear",
          description: "Oversized tees, hoodies and denim.",
        },
      },
    })
    await publishRevision(system, { revisionId: settings.revisionId })
    expect(await loadPublishedSiteSettings()).toMatchObject({
      brandName: "Duis",
    })
  })
})

import { sql } from "drizzle-orm"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  adminListPages,
  createPage,
  getPageEditor,
  listPageRevisions,
  listScheduled,
  loadPreview,
  loadPublishedPage,
  publishScheduled,
  type PageData,
} from "@/features/cms"
import {
  archivePage,
  autosavePageDraft,
  cancelPageSchedule,
  createPreviewLink,
  publishPage,
  requestPageChanges,
  restorePage,
  restoreRevision,
  schedulePage,
  submitPageForReview,
  unpublishPage,
  withdrawPageSubmission,
} from "@/features/cms/workflow"
import { adminListMedia, deleteMedia, uploadImage } from "@/features/media"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"

import { asSystem, createUserActor, unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"
import { code } from "../helpers/shop"

closeConnectionsAfterAll()

let manager: Actor
let editor: Actor
let storeAdmin: Actor

const announce = (text: string, id = "note"): PageData => ({
  sections: [{ id, type: "announcement", enabled: true, text }],
  seo: {},
})

async function newPage(type: "landing" | "home" = "landing") {
  const slug = unique("edit")
  const { id } = await createPage(manager, { type, slug, title: "The Edit" })
  return { id, slug }
}

async function base(pageId: string) {
  const state = await getPageEditor(manager, { pageId })
  return state.draft
    ? { revisionId: state.draft.revisionId, updatedAt: state.draft.updatedAt }
    : null
}

beforeAll(async () => {
  manager = await createUserActor("content_manager")
  editor = await createUserActor("content_editor")
  storeAdmin = await createUserActor("store_admin")
})

afterEach(() => {
  vi.useRealTimers()
})

describe("autosave", () => {
  it("edits the working draft in place and refuses stale saves", async () => {
    const page = await newPage()
    const first = await autosavePageDraft(editor, {
      pageId: page.id,
      data: announce("one"),
      base: null,
    })
    const second = await autosavePageDraft(editor, {
      pageId: page.id,
      data: announce("two"),
      base: { revisionId: first.revisionId, updatedAt: first.updatedAt },
    })
    expect(second.revisionId).toBe(first.revisionId)
    expect(second.version).toBe(1)

    // Someone saved since this editor loaded the page.
    expect(
      await code(
        autosavePageDraft(editor, {
          pageId: page.id,
          data: announce("three"),
          base: { revisionId: first.revisionId, updatedAt: first.updatedAt },
        }),
      ),
    ).toBe("CONFLICT")
    expect(
      await code(
        autosavePageDraft(editor, {
          pageId: page.id,
          data: announce("three"),
          base: null,
        }),
      ),
    ).toBe("CONFLICT")
    const state = await getPageEditor(editor, { pageId: page.id })
    expect(state.data).toEqual(announce("two"))
  })

  it("is refused for roles that can only read content", async () => {
    const page = await newPage()
    expect(
      await code(
        autosavePageDraft(storeAdmin, {
          pageId: page.id,
          data: announce("x"),
          base: null,
        }),
      ),
    ).toBe("FORBIDDEN")
  })
})

describe("review and publishing", () => {
  it("editors submit, managers send back or publish", async () => {
    const page = await newPage()
    await autosavePageDraft(editor, {
      pageId: page.id,
      data: announce("draft"),
      base: null,
    })
    expect(await code(publishPage(editor, { pageId: page.id }))).toBe(
      "FORBIDDEN",
    )
    await submitPageForReview(editor, { pageId: page.id, note: "Ready" })
    expect(
      (await adminListPages(manager, { view: "review" })).rows.map((r) => r.id),
    ).toContain(page.id)

    // Locked while it waits.
    expect(
      await code(
        autosavePageDraft(editor, {
          pageId: page.id,
          data: announce("sneaky"),
          base: await base(page.id),
        }),
      ),
    ).toBe("INVALID_STATE")
    expect(
      await code(
        requestPageChanges(editor, { pageId: page.id, reviewNote: "no" }),
      ),
    ).toBe("FORBIDDEN")

    await requestPageChanges(manager, {
      pageId: page.id,
      reviewNote: "Shorter, please",
    })
    const sentBack = await getPageEditor(editor, { pageId: page.id })
    expect(sentBack.draft).toMatchObject({
      status: "draft",
      reviewNote: "Shorter, please",
    })

    await submitPageForReview(editor, { pageId: page.id })
    await withdrawPageSubmission(editor, { pageId: page.id })
    await submitPageForReview(editor, { pageId: page.id })
    await publishPage(manager, { pageId: page.id })

    const live = await loadPublishedPage(page.slug)
    expect(live?.data).toEqual(announce("draft"))
    const jobs = await getDb().execute(sql`
      select 1 from pgboss.job where name = 'cache.revalidate'
        and data->'tags' ? ${`cms:page:${page.slug}`}`)
    expect(jobs.rows.length).toBeGreaterThan(0)
    const audit = await getDb().execute<{ action: string }>(sql`
      select action from audit_logs where entity_id = ${page.id} order by created_at`)
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "cms.page.submit",
        "cms.page.request_changes",
        "cms.page.withdraw",
        "cms.publish",
      ]),
    )
  })

  it("starts a new version after publishing, with a change summary", async () => {
    const page = await newPage()
    await autosavePageDraft(manager, {
      pageId: page.id,
      data: announce("v1"),
      base: null,
    })
    await publishPage(manager, { pageId: page.id })
    const next = await autosavePageDraft(manager, {
      pageId: page.id,
      data: {
        ...announce("v2"),
        sections: [
          ...announce("v2").sections,
          { id: "more", type: "newsletter", enabled: true, heading: "Join" },
        ],
      },
      base: await base(page.id),
    })
    expect(next.version).toBe(2)
    const history = await listPageRevisions(manager, { pageId: page.id })
    expect(history.map((r) => [r.version, r.status, r.live])).toEqual([
      [2, "draft", false],
      [1, "published", true],
    ])
    expect(history[0]!.changes).toBe("Sections: 1 added, 1 edited")

    await restoreRevision(manager, {
      pageId: page.id,
      revisionId: history[1]!.id,
    })
    expect((await getPageEditor(manager, { pageId: page.id })).data).toEqual(
      announce("v1"),
    )
  })

  it("takes pages offline, archives and restores them, never the home page", async () => {
    const page = await newPage()
    await autosavePageDraft(manager, {
      pageId: page.id,
      data: announce("live"),
      base: null,
    })
    await publishPage(manager, { pageId: page.id })
    await unpublishPage(manager, { pageId: page.id })
    expect(await loadPublishedPage(page.slug)).toBeNull()
    // The same content can go back up without an edit.
    await publishPage(manager, { pageId: page.id })
    expect((await loadPublishedPage(page.slug))?.data).toEqual(announce("live"))

    expect(await code(archivePage(editor, { pageId: page.id }))).toBe(
      "FORBIDDEN",
    )
    await archivePage(manager, { pageId: page.id })
    expect(await loadPublishedPage(page.slug)).toBeNull()
    expect(
      await code(
        autosavePageDraft(manager, {
          pageId: page.id,
          data: announce("x"),
          base: await base(page.id),
        }),
      ),
    ).toBe("INVALID_STATE")
    await restorePage(manager, { pageId: page.id })
    expect(
      (await getPageEditor(manager, { pageId: page.id })).page.status,
    ).toBe("draft")

    const home = await newPage("home")
    await autosavePageDraft(manager, {
      pageId: home.id,
      data: announce("home"),
      base: null,
    })
    await publishPage(manager, { pageId: home.id })
    expect(await code(unpublishPage(manager, { pageId: home.id }))).toBe(
      "INVALID_STATE",
    )
    expect(await code(archivePage(manager, { pageId: home.id }))).toBe(
      "INVALID_STATE",
    )
  })
})

describe("scheduling", () => {
  it("publishes on time from the worker job", async () => {
    const page = await newPage()
    await autosavePageDraft(manager, {
      pageId: page.id,
      data: announce("later"),
      base: null,
    })
    expect(
      await code(
        schedulePage(manager, {
          pageId: page.id,
          at: new Date(Date.now() - 60_000).toISOString(),
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    expect(
      await code(
        schedulePage(editor, {
          pageId: page.id,
          at: new Date(Date.now() + 5 * 60_000).toISOString(),
        }),
      ),
    ).toBe("FORBIDDEN")

    const at = new Date(Date.now() + 5 * 60_000)
    await schedulePage(manager, { pageId: page.id, at: at.toISOString() })
    expect((await listScheduled(manager, {})).map((s) => s.pageId)).toContain(
      page.id,
    )

    // Not yet due.
    await publishScheduled(new Date())
    expect(await loadPublishedPage(page.slug)).toBeNull()

    await publishScheduled(new Date(at.getTime() + 1_000))
    expect((await loadPublishedPage(page.slug))?.data).toEqual(
      announce("later"),
    )
  })

  it("can be cancelled, and archiving cancels it", async () => {
    const page = await newPage()
    await autosavePageDraft(manager, {
      pageId: page.id,
      data: announce("maybe"),
      base: null,
    })
    const at = new Date(Date.now() + 5 * 60_000)
    await schedulePage(manager, { pageId: page.id, at: at.toISOString() })
    await cancelPageSchedule(manager, { pageId: page.id })
    await schedulePage(manager, { pageId: page.id, at: at.toISOString() })
    await archivePage(manager, { pageId: page.id })
    await publishScheduled(new Date(at.getTime() + 1_000))
    expect(await loadPublishedPage(page.slug)).toBeNull()
  })
})

describe("preview links", () => {
  it("open exactly that revision for 24 hours, and not if tampered with", async () => {
    const page = await newPage()
    const draft = await autosavePageDraft(editor, {
      pageId: page.id,
      data: announce("preview me"),
      base: null,
    })
    const { path } = await createPreviewLink(editor, {
      revisionId: draft.revisionId,
    })
    const token = path.replace("/preview/", "")
    expect((await loadPreview(token))?.data).toEqual(announce("preview me"))
    expect(await loadPreview(`${token.slice(0, -1)}x`)).toBeNull()

    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 25 * 3600_000)
    expect(await loadPreview(token)).toBeNull()
  })
})

describe("media in use", () => {
  it("can't be deleted while a page uses it", async () => {
    const image = await uploadImage(asSystem(), {
      bytes: await makeUniqueImage(),
      altText: "Campaign",
    })
    const page = await newPage()
    await autosavePageDraft(manager, {
      pageId: page.id,
      data: {
        sections: [
          {
            id: "story",
            type: "brand_story",
            enabled: true,
            heading: "Story",
            content: { type: "doc", content: [{ type: "paragraph" }] },
            mediaId: image.id,
          },
        ],
        seo: {},
      },
      base: null,
    })
    expect(await code(deleteMedia(manager, { id: image.id }))).toBe("CONFLICT")
    const listed = await adminListMedia(editor, { q: "Campaign" })
    expect(listed.items.map((m) => m.id)).toContain(image.id)
  })
})

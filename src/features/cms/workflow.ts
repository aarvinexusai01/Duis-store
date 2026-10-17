import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { loadCatalogTree, loadMediaRefs } from "@/features/catalog"
import { systemActor, type Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { logger } from "@/server/observability/logger"
import { defineOperation } from "@/server/operation"

import { describeDiff, diffPages } from "./revision-diff"
import { pageDataSchema, type PageData } from "./schemas"
import {
  insertRefs,
  insertRevision,
  pageRefs,
  publishRevision,
} from "./service"

/**
 * The page workflow behind the CMS portal (doc/06 Phase 6a, owner decision
 * 2026-10-17): a working draft edited in place by autosave, frozen into a
 * numbered revision when it is submitted, published or scheduled. Content
 * Managers publish directly; Content Editors submit for review.
 */

export type WorkflowStatus =
  "draft" | "in_review" | "approved" | "scheduled" | "published" | "archived"

type PageRow = {
  id: string
  type: "home" | "landing" | "static" | "policy"
  slug: string
  title: string
  status: "draft" | "published" | "archived"
  draft_revision_id: string | null
  published_revision_id: string | null
  published_at: Date | null
}

type RevisionRow = {
  id: string
  version: number
  data: unknown
  workflow_status: WorkflowStatus
  note: string | null
  review_note: string | null
  scheduled_for: Date | null
  updated_at: Date
}

const actorId = (actor: Actor) => (actor.kind === "user" ? actor.userId : null)

async function lockPage(tx: Transaction, pageId: string): Promise<PageRow> {
  const found = await tx.execute<PageRow>(sql`
    select id, type, slug::text, title, status, draft_revision_id, published_revision_id, published_at
    from cms_pages where id = ${pageId} for update`)
  const page = found.rows[0]
  if (!page) throw new DomainError("NOT_FOUND", "Page not found.")
  return page
}

async function revision(
  db: Transaction | ReturnType<typeof getDb>,
  revisionId: string | null,
  lock = false,
): Promise<RevisionRow | null> {
  if (!revisionId) return null
  const found = await db.execute<RevisionRow>(sql`
    select id, version, data, workflow_status, note, review_note, scheduled_for, updated_at
    from cms_revisions where id = ${revisionId} and entity_type = 'page'
    ${lock ? sql`for update` : sql``}`)
  return found.rows[0] ?? null
}

/** The page's working draft, if its latest revision is still editable. */
async function workingDraft(tx: Transaction, page: PageRow) {
  const draft = await revision(tx, page.draft_revision_id, true)
  return draft?.workflow_status === "draft" ? draft : null
}

// --- Reads -----------------------------------------------------------------------------

export type AdminPageRow = {
  id: string
  type: PageRow["type"]
  slug: string
  title: string
  status: PageRow["status"]
  draftStatus: WorkflowStatus | null
  unpublishedChanges: boolean
  scheduledFor: Date | null
  updatedAt: Date
}

export const adminListPages = defineOperation({
  name: "cms.adminListPages",
  access: { cms: ["read"] },
  input: z.object({
    view: z.enum(["all", "review", "scheduled"]).default("all"),
  }),
  async handler(_ctx, { view }) {
    const rows = await getDb().execute<{
      id: string
      type: PageRow["type"]
      slug: string
      title: string
      status: PageRow["status"]
      draft_status: WorkflowStatus | null
      changed: boolean
      scheduled_for: Date | null
      updated_at: Date
    }>(sql`
      select p.id, p.type, p.slug::text, p.title, p.status,
             d.workflow_status as draft_status,
             (p.draft_revision_id is distinct from p.published_revision_id
               and d.workflow_status in ('draft', 'in_review', 'scheduled')) as changed,
             d.scheduled_for,
             greatest(p.updated_at, coalesce(d.updated_at, p.updated_at)) as updated_at
      from cms_pages p
      left join cms_revisions d on d.id = p.draft_revision_id
      where ${
        view === "review"
          ? sql`d.workflow_status = 'in_review' and p.status <> 'archived'`
          : view === "scheduled"
            ? sql`d.workflow_status = 'scheduled' and p.status <> 'archived'`
            : sql`true`
      }
      order by (p.type = 'home') desc, p.status = 'archived', p.title`)
    const counts = await getDb().execute<{ review: number; scheduled: number }>(
      sql`
        select count(*) filter (where d.workflow_status = 'in_review')::int as review,
               count(*) filter (where d.workflow_status = 'scheduled')::int as scheduled
        from cms_pages p join cms_revisions d on d.id = p.draft_revision_id
        where p.status <> 'archived'`,
    )
    return {
      counts: counts.rows[0] ?? { review: 0, scheduled: 0 },
      rows: rows.rows.map((r): AdminPageRow => ({
        id: r.id,
        type: r.type,
        slug: r.slug,
        title: r.title,
        status: r.status,
        draftStatus: r.draft_status,
        unpublishedChanges: r.changed,
        scheduledFor: r.scheduled_for,
        updatedAt: r.updated_at,
      })),
    }
  },
})

export type PageEditorState = {
  page: {
    id: string
    type: PageRow["type"]
    slug: string
    title: string
    status: PageRow["status"]
    publishedAt: Date | null
  }
  data: PageData
  /** The revision being edited, and its save token (null before the first edit). */
  draft: {
    revisionId: string
    version: number
    status: WorkflowStatus
    updatedAt: string
    reviewNote: string | null
    scheduledFor: Date | null
  } | null
  publishedRevisionId: string | null
}

export const getPageEditor = defineOperation({
  name: "cms.getPageEditor",
  access: { cms: ["read"] },
  input: z.object({ pageId: z.uuid() }),
  async handler(_ctx, { pageId }): Promise<PageEditorState> {
    const found = await getDb().execute<PageRow>(sql`
      select id, type, slug::text, title, status, draft_revision_id, published_revision_id, published_at
      from cms_pages where id = ${pageId}`)
    const page = found.rows[0]
    if (!page) throw new DomainError("NOT_FOUND", "Page not found.")
    const current = await revision(getDb(), page.draft_revision_id)
    const parsed = current ? pageDataSchema.safeParse(current.data) : null
    return {
      page: {
        id: page.id,
        type: page.type,
        slug: page.slug,
        title: page.title,
        status: page.status,
        publishedAt: page.published_at,
      },
      data: parsed?.success ? parsed.data : { sections: [], seo: {} },
      draft: current
        ? {
            revisionId: current.id,
            version: current.version,
            status: current.workflow_status,
            updatedAt: new Date(current.updated_at).toISOString(),
            reviewNote: current.review_note,
            scheduledFor: current.scheduled_for,
          }
        : null,
      publishedRevisionId: page.published_revision_id,
    }
  },
})

/**
 * Names and thumbnails for the builder: everything the page points at, and
 * the collections and categories it can choose from.
 */
export async function loadEditorLabels(data: PageData) {
  const refs = pageRefs(data)
  const [media, products, collections, tree] = await Promise.all([
    loadMediaRefs([...refs.mediaIds]),
    refs.productIds.size > 0
      ? getDb().execute<{ id: string; title: string }>(sql`
          select id, title from products where id in (${sql.join(
            [...refs.productIds].map((id) => sql`${id}`),
            sql`, `,
          )})`)
      : Promise.resolve({ rows: [] as { id: string; title: string }[] }),
    getDb().execute<{ id: string; title: string; status: string }>(sql`
      select id, title, status from collections where status <> 'archived' order by title`),
    loadCatalogTree(),
  ])
  return {
    media: [...media].map(([id, ref]) => ({ id, key: ref.key, alt: ref.alt })),
    products: products.rows.map((p) => ({ id: p.id, label: p.title })),
    collections: collections.rows.map((c) => ({
      id: c.id,
      label: c.status === "published" ? c.title : `${c.title} (draft)`,
    })),
    categories: tree.categories.map((c) => ({
      id: c.id,
      label: `${"– ".repeat(c.depth)}${c.name}`,
    })),
  }
}

// --- Editing ---------------------------------------------------------------------------

/**
 * Autosave. Edits the working draft in place; if the latest revision is
 * frozen (submitted, scheduled or published), starts a new draft from this
 * data. `base` is what the editor last loaded or saved: if someone else has
 * saved since, nothing is written and the editor is asked to reload.
 */
export const autosavePageDraft = defineOperation({
  name: "cms.autosavePageDraft",
  access: { cms: ["draft"] },
  input: z.object({
    pageId: z.uuid(),
    data: pageDataSchema,
    base: z
      .object({ revisionId: z.uuid(), updatedAt: z.iso.datetime() })
      .nullable(),
  }),
  async handler({ actor }, { pageId, data, base }) {
    return withTransaction(async (tx) => {
      const page = await lockPage(tx, pageId)
      if (page.status === "archived")
        throw new DomainError("INVALID_STATE", "Restore the page to edit it.")
      if ((base?.revisionId ?? null) !== page.draft_revision_id) {
        throw new DomainError(
          "CONFLICT",
          "Someone else changed this page. Reload to see their version.",
        )
      }
      const latest = await revision(tx, page.draft_revision_id)
      if (
        latest &&
        ["in_review", "approved", "scheduled"].includes(latest.workflow_status)
      ) {
        throw new DomainError(
          "INVALID_STATE",
          "This version is waiting to be reviewed or published. Withdraw it or cancel the schedule to edit.",
        )
      }
      const draft = await workingDraft(tx, page)
      if (draft) {
        if (new Date(draft.updated_at).toISOString() !== base!.updatedAt) {
          throw new DomainError(
            "CONFLICT",
            "Someone else changed this page. Reload to see their version.",
          )
        }
        const updated = await tx.execute<{ updated_at: Date }>(sql`
          update cms_revisions set data = ${JSON.stringify(data)}::jsonb,
            created_by = coalesce(created_by, ${actorId(actor)}), updated_at = now()
          where id = ${draft.id} returning updated_at`)
        await tx.execute(
          sql`delete from cms_revision_refs where revision_id = ${draft.id}`,
        )
        await insertRefs(tx, draft.id, pageRefs(data))
        return {
          revisionId: draft.id,
          version: draft.version,
          updatedAt: new Date(updated.rows[0]!.updated_at).toISOString(),
        }
      }
      const created = await insertRevision(
        tx,
        "page",
        pageId,
        data,
        pageRefs(data),
        actorId(actor),
      )
      await tx.execute(
        sql`update cms_pages set draft_revision_id = ${created.revisionId}, updated_at = now() where id = ${pageId}`,
      )
      await writeAudit(tx, actor, {
        action: "cms.page.draft_started",
        entityType: "cms_page",
        entityId: pageId,
        changes: { version: created.version },
      })
      const saved = await revision(tx, created.revisionId)
      return {
        revisionId: created.revisionId,
        version: created.version,
        updatedAt: new Date(saved!.updated_at).toISOString(),
      }
    })
  },
})

/** Title changes apply straight away (the slug is fixed after creation). */
export const renamePage = defineOperation({
  name: "cms.renamePage",
  access: { cms: ["draft"] },
  input: z.object({
    pageId: z.uuid(),
    title: z.string().trim().min(1).max(120),
  }),
  async handler({ actor }, { pageId, title }) {
    return withTransaction(async (tx) => {
      const page = await lockPage(tx, pageId)
      await tx.execute(
        sql`update cms_pages set title = ${title}, updated_at = now() where id = ${pageId}`,
      )
      await requestRevalidation(
        [cacheTags.cmsPage(page.slug), cacheTags.cmsPagesList],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "cms.page.rename",
        entityType: "cms_page",
        entityId: pageId,
        changes: { from: page.title, to: title },
      })
      return {}
    })
  },
})

// --- Workflow --------------------------------------------------------------------------

async function draftFor(
  tx: Transaction,
  pageId: string,
  allowed: WorkflowStatus[],
  message: string,
) {
  const page = await lockPage(tx, pageId)
  if (page.status === "archived")
    throw new DomainError("INVALID_STATE", "Restore the page first.")
  const current = await revision(tx, page.draft_revision_id, true)
  if (!current || !allowed.includes(current.workflow_status))
    throw new DomainError("INVALID_STATE", message)
  return { page, current }
}

async function setStatus(
  tx: Transaction,
  revisionId: string,
  status: WorkflowStatus,
  extra: {
    note?: string | null
    reviewNote?: string | null
    reviewedBy?: string | null
    scheduledFor?: Date | null
  } = {},
) {
  await tx.execute(sql`
    update cms_revisions set workflow_status = ${status}::cms_workflow_status,
      ${extra.note !== undefined ? sql`note = ${extra.note},` : sql``}
      ${extra.reviewNote !== undefined ? sql`review_note = ${extra.reviewNote},` : sql``}
      ${extra.reviewedBy !== undefined ? sql`reviewed_by = ${extra.reviewedBy},` : sql``}
      ${extra.scheduledFor !== undefined ? sql`scheduled_for = ${extra.scheduledFor},` : sql``}
      updated_at = now()
    where id = ${revisionId}`)
}

/** Content Editors: hand the working draft to a manager. */
export const submitPageForReview = defineOperation({
  name: "cms.submitForReview",
  access: { cms: ["draft"] },
  input: z.object({
    pageId: z.uuid(),
    note: z.string().trim().max(300).optional(),
  }),
  async handler({ actor }, { pageId, note }) {
    return withTransaction(async (tx) => {
      const { current } = await draftFor(
        tx,
        pageId,
        ["draft"],
        "Only a draft can be submitted.",
      )
      pageDataSchema.parse(current.data)
      await setStatus(tx, current.id, "in_review", {
        note: note ?? null,
        reviewNote: null,
      })
      await writeAudit(tx, actor, {
        action: "cms.page.submit",
        entityType: "cms_page",
        entityId: pageId,
        changes: { version: current.version, note },
      })
      return {}
    })
  },
})

/** Authors: take a submission back to keep editing. */
export const withdrawPageSubmission = defineOperation({
  name: "cms.withdrawSubmission",
  access: { cms: ["draft"] },
  input: z.object({ pageId: z.uuid() }),
  async handler({ actor }, { pageId }) {
    return withTransaction(async (tx) => {
      const { current } = await draftFor(
        tx,
        pageId,
        ["in_review"],
        "Nothing is waiting for review.",
      )
      await setStatus(tx, current.id, "draft")
      await writeAudit(tx, actor, {
        action: "cms.page.withdraw",
        entityType: "cms_page",
        entityId: pageId,
        changes: { version: current.version },
      })
      return {}
    })
  },
})

/** Managers: send a submitted draft back to its author with a reason. */
export const requestPageChanges = defineOperation({
  name: "cms.requestChanges",
  access: { cms: ["review"] },
  input: z.object({
    pageId: z.uuid(),
    reviewNote: z.string().trim().min(1, "Say what needs changing.").max(500),
  }),
  async handler({ actor }, { pageId, reviewNote }) {
    return withTransaction(async (tx) => {
      const { current } = await draftFor(
        tx,
        pageId,
        ["in_review"],
        "Only a submitted draft can be sent back.",
      )
      await setStatus(tx, current.id, "draft", {
        reviewNote,
        reviewedBy: actorId(actor),
      })
      await writeAudit(tx, actor, {
        action: "cms.page.request_changes",
        entityType: "cms_page",
        entityId: pageId,
        changes: { version: current.version, reviewNote },
      })
      return {}
    })
  },
})

/** Managers: publish the working draft (or a submitted one) now. */
export const publishPage = defineOperation({
  name: "cms.publishPage",
  access: { cms: ["publish"] },
  input: z.object({ pageId: z.uuid() }),
  async handler({ actor }, { pageId }) {
    const revisionId = await withTransaction(async (tx) => {
      const page = await lockPage(tx, pageId)
      if (page.status === "archived")
        throw new DomainError("INVALID_STATE", "Restore the page first.")
      const latest = await revision(tx, page.draft_revision_id, true)
      // Taken offline earlier and not edited since: publish that content as
      // a new version.
      if (
        latest &&
        page.status !== "published" &&
        ["published", "archived"].includes(latest.workflow_status)
      ) {
        const data = pageDataSchema.parse(latest.data)
        const copy = await insertRevision(
          tx,
          "page",
          pageId,
          data,
          pageRefs(data),
          actorId(actor),
          `Republished version ${latest.version}`,
        )
        await tx.execute(
          sql`update cms_pages set draft_revision_id = ${copy.revisionId}, updated_at = now() where id = ${pageId}`,
        )
        return copy.revisionId
      }
      const { current } = await draftFor(
        tx,
        pageId,
        ["draft", "in_review", "approved", "scheduled"],
        "There are no unpublished changes.",
      )
      if (current.workflow_status === "in_review")
        await setStatus(tx, current.id, "in_review", {
          reviewedBy: actorId(actor),
        })
      return current.id
    })
    await publishRevision(actor, { revisionId })
    return { revisionId }
  },
})

/** Managers: publish at a set time (the worker checks every minute). */
export const schedulePage = defineOperation({
  name: "cms.schedulePage",
  access: { cms: ["publish"] },
  input: z.object({ pageId: z.uuid(), at: z.iso.datetime({ offset: true }) }),
  async handler({ actor }, { pageId, at }) {
    const when = new Date(at)
    const now = Date.now()
    if (when.getTime() < now + 60_000)
      throw new DomainError(
        "VALIDATION_FAILED",
        "Pick a time at least a minute from now.",
        { issues: { at: ["Pick a time at least a minute from now."] } },
      )
    if (when.getTime() > now + 366 * 24 * 3600_000)
      throw new DomainError(
        "VALIDATION_FAILED",
        "Pick a time within the next year.",
        { issues: { at: ["Pick a time within the next year."] } },
      )
    return withTransaction(async (tx) => {
      const { current } = await draftFor(
        tx,
        pageId,
        ["draft", "in_review", "approved", "scheduled"],
        "There are no unpublished changes to schedule.",
      )
      pageDataSchema.parse(current.data)
      await setStatus(tx, current.id, "scheduled", {
        scheduledFor: when,
        ...(current.workflow_status === "in_review"
          ? { reviewedBy: actorId(actor) }
          : {}),
      })
      await writeAudit(tx, actor, {
        action: "cms.page.schedule",
        entityType: "cms_page",
        entityId: pageId,
        changes: { version: current.version, at: when.toISOString() },
      })
      return { scheduledFor: when }
    })
  },
})

export const cancelPageSchedule = defineOperation({
  name: "cms.cancelSchedule",
  access: { cms: ["publish"] },
  input: z.object({ pageId: z.uuid() }),
  async handler({ actor }, { pageId }) {
    return withTransaction(async (tx) => {
      const { current } = await draftFor(
        tx,
        pageId,
        ["scheduled"],
        "Nothing is scheduled for this page.",
      )
      await setStatus(tx, current.id, "draft", { scheduledFor: null })
      await writeAudit(tx, actor, {
        action: "cms.page.cancel_schedule",
        entityType: "cms_page",
        entityId: pageId,
        changes: { version: current.version },
      })
      return {}
    })
  },
})

async function takeOffline(
  tx: Transaction,
  actor: Actor,
  page: PageRow,
  status: "draft" | "archived",
) {
  if (page.type === "home")
    throw new DomainError("INVALID_STATE", "The home page is always live.")
  if (page.published_revision_id) {
    await setStatus(tx, page.published_revision_id, "archived")
  }
  // A pending schedule would put it back online.
  await tx.execute(sql`
    update cms_revisions set workflow_status = 'draft', scheduled_for = null, updated_at = now()
    where entity_type = 'page' and entity_id = ${page.id} and workflow_status = 'scheduled'`)
  await tx.execute(sql`
    update cms_pages set status = ${status}::publication_status, published_revision_id = null,
      updated_at = now()
    where id = ${page.id}`)
  await requestRevalidation(
    [cacheTags.cmsPage(page.slug), cacheTags.cmsPagesList],
    { tx },
  )
  await writeAudit(tx, actor, {
    action: status === "archived" ? "cms.page.archive" : "cms.page.unpublish",
    entityType: "cms_page",
    entityId: page.id,
    changes: { slug: page.slug },
  })
}

/** Takes the page off the site; its content stays for re-publishing. */
export const unpublishPage = defineOperation({
  name: "cms.unpublishPage",
  access: { cms: ["publish"] },
  input: z.object({ pageId: z.uuid() }),
  async handler({ actor }, { pageId }) {
    return withTransaction(async (tx) => {
      const page = await lockPage(tx, pageId)
      if (page.status !== "published")
        throw new DomainError("INVALID_STATE", "The page isn't live.")
      await takeOffline(tx, actor, page, "draft")
      return {}
    })
  },
})

export const archivePage = defineOperation({
  name: "cms.archivePage",
  access: { cms: ["archive"] },
  input: z.object({ pageId: z.uuid() }),
  async handler({ actor }, { pageId }) {
    return withTransaction(async (tx) => {
      const page = await lockPage(tx, pageId)
      if (page.status === "archived") return {}
      await takeOffline(tx, actor, page, "archived")
      return {}
    })
  },
})

export const restorePage = defineOperation({
  name: "cms.restorePage",
  access: { cms: ["archive"] },
  input: z.object({ pageId: z.uuid() }),
  async handler({ actor }, { pageId }) {
    return withTransaction(async (tx) => {
      const page = await lockPage(tx, pageId)
      if (page.status !== "archived") return {}
      await tx.execute(
        sql`update cms_pages set status = 'draft', updated_at = now() where id = ${pageId}`,
      )
      await writeAudit(tx, actor, {
        action: "cms.page.restore",
        entityType: "cms_page",
        entityId: pageId,
      })
      return {}
    })
  },
})

/** Rollback: copy an older revision into the working draft. */
export const restoreRevision = defineOperation({
  name: "cms.restoreRevision",
  access: { cms: ["draft"] },
  input: z.object({ pageId: z.uuid(), revisionId: z.uuid() }),
  async handler({ actor }, { pageId, revisionId }) {
    return withTransaction(async (tx) => {
      const page = await lockPage(tx, pageId)
      const source = await tx.execute<{ data: unknown; version: number }>(sql`
        select data, version from cms_revisions
        where id = ${revisionId} and entity_type = 'page' and entity_id = ${pageId}`)
      const row = source.rows[0]
      if (!row) throw new DomainError("NOT_FOUND", "Revision not found.")
      const data = pageDataSchema.parse(row.data)
      const draft = await workingDraft(tx, page)
      if (draft) {
        await tx.execute(sql`
          update cms_revisions set data = ${JSON.stringify(data)}::jsonb, updated_at = now()
          where id = ${draft.id}`)
        await tx.execute(
          sql`delete from cms_revision_refs where revision_id = ${draft.id}`,
        )
        await insertRefs(tx, draft.id, pageRefs(data))
      } else {
        const created = await insertRevision(
          tx,
          "page",
          pageId,
          data,
          pageRefs(data),
          actorId(actor),
          `Restored from version ${row.version}`,
        )
        await tx.execute(
          sql`update cms_pages set draft_revision_id = ${created.revisionId}, updated_at = now() where id = ${pageId}`,
        )
      }
      await writeAudit(tx, actor, {
        action: "cms.page.restore_revision",
        entityType: "cms_page",
        entityId: pageId,
        changes: { fromVersion: row.version },
      })
      return {}
    })
  },
})

// --- History and scheduling overview ---------------------------------------------------

export type RevisionSummary = {
  id: string
  version: number
  status: WorkflowStatus
  author: string | null
  reviewer: string | null
  publisher: string | null
  note: string | null
  reviewNote: string | null
  scheduledFor: Date | null
  publishedAt: Date | null
  updatedAt: Date
  live: boolean
  changes: string
}

export const listPageRevisions = defineOperation({
  name: "cms.listPageRevisions",
  access: { cms: ["read"] },
  input: z.object({ pageId: z.uuid() }),
  async handler(_ctx, { pageId }): Promise<RevisionSummary[]> {
    const rows = await getDb().execute<{
      id: string
      version: number
      data: unknown
      workflow_status: WorkflowStatus
      author: string | null
      reviewer: string | null
      publisher: string | null
      note: string | null
      review_note: string | null
      scheduled_for: Date | null
      published_at: Date | null
      updated_at: Date
      live: boolean
    }>(sql`
      select r.id, r.version, r.data, r.workflow_status, a.name as author, v.name as reviewer,
             pb.name as publisher, r.note, r.review_note, r.scheduled_for, r.published_at,
             r.updated_at, (p.published_revision_id = r.id) as live
      from cms_revisions r
      join cms_pages p on p.id = r.entity_id
      left join users a on a.id = r.created_by
      left join users v on v.id = r.reviewed_by
      left join users pb on pb.id = r.published_by
      where r.entity_type = 'page' and r.entity_id = ${pageId}
      order by r.version desc
      limit 100`)
    const ordered = [...rows.rows].reverse()
    const summaries = ordered.map((row, i): RevisionSummary => {
      const data = pageDataSchema.safeParse(row.data)
      const before =
        i > 0 ? pageDataSchema.safeParse(ordered[i - 1]!.data) : null
      const changes =
        data.success && (i === 0 || before?.success)
          ? describeDiff(
              diffPages(before?.success ? before.data : null, data.data),
              i === 0,
            )
          : "Content from an older format"
      return {
        id: row.id,
        version: row.version,
        status: row.workflow_status,
        author: row.author,
        reviewer: row.reviewer,
        publisher: row.publisher,
        note: row.note,
        reviewNote: row.review_note,
        scheduledFor: row.scheduled_for,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
        live: row.live,
        changes,
      }
    })
    return summaries.reverse()
  },
})

export const listScheduled = defineOperation({
  name: "cms.listScheduled",
  access: { cms: ["read"] },
  input: z.object({}),
  async handler() {
    const rows = await getDb().execute<{
      revision_id: string
      page_id: string
      title: string
      slug: string
      version: number
      scheduled_for: Date
      scheduled_by: string | null
    }>(sql`
      select r.id as revision_id, p.id as page_id, p.title, p.slug::text, r.version, r.scheduled_for,
             (select u.name from audit_logs l join users u on u.id = l.actor_user_id
              where l.entity_id = p.id::text and l.action = 'cms.page.schedule'
              order by l.created_at desc limit 1) as scheduled_by
      from cms_revisions r join cms_pages p on p.id = r.entity_id
      where r.entity_type = 'page' and r.workflow_status = 'scheduled'
      order by r.scheduled_for`)
    return rows.rows.map((r) => ({
      revisionId: r.revision_id,
      pageId: r.page_id,
      title: r.title,
      slug: r.slug,
      version: r.version,
      scheduledFor: r.scheduled_for,
      scheduledBy: r.scheduled_by,
    }))
  },
})

/**
 * cms.publish-scheduled job (every minute): publishes what is due. Each is
 * published on its own, so one bad revision doesn't hold up the rest.
 */
export async function publishScheduled(now = new Date()): Promise<number> {
  const due = await getDb().execute<{ id: string }>(sql`
    select id from cms_revisions
    where workflow_status = 'scheduled' and scheduled_for <= ${now}
    order by scheduled_for limit 50`)
  const actor = systemActor("cms-scheduler")
  let published = 0
  for (const { id } of due.rows) {
    try {
      const result = await publishRevision(actor, { revisionId: id })
      if (!result.alreadyPublished) published += 1
    } catch (err) {
      logger.error({ err, revisionId: id }, "scheduled publish failed")
    }
  }
  return published
}

// --- Preview links ---------------------------------------------------------------------

const PREVIEW_TTL_SECONDS = 24 * 3600

function previewSignature(revisionId: string, expires: number): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`cms-preview:${revisionId}:${expires}`)
    .digest("base64url")
    .slice(0, 32)
}

/** A shareable link to exactly this revision, valid for 24 hours. */
export const createPreviewLink = defineOperation({
  name: "cms.createPreviewLink",
  access: { cms: ["read"] },
  input: z.object({ revisionId: z.uuid() }),
  async handler(_ctx, { revisionId }) {
    const found = await getDb().execute<{ id: string }>(
      sql`select id from cms_revisions where id = ${revisionId} and entity_type = 'page'`,
    )
    if (!found.rows[0])
      throw new DomainError("NOT_FOUND", "Revision not found.")
    const expires = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS
    const token = `${revisionId}.${expires}.${previewSignature(revisionId, expires)}`
    return {
      path: `/preview/${token}`,
      expiresAt: new Date(expires * 1000),
    }
  },
})

export type PreviewPage = {
  revisionId: string
  version: number
  type: PageRow["type"]
  slug: string
  title: string
  data: PageData
  expiresAt: Date
}

/** The revision behind a preview token, or null if the link is bad or old. */
export async function loadPreview(token: string): Promise<PreviewPage | null> {
  const match =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{10})\.([\w-]{32})$/.exec(
      token,
    )
  if (!match) return null
  const [, revisionId, expiresText, signature] = match
  const expires = Number(expiresText)
  if (expires * 1000 < Date.now()) return null
  const expected = Buffer.from(previewSignature(revisionId!, expires))
  const given = Buffer.from(signature!)
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null
  const found = await getDb().execute<{
    version: number
    data: unknown
    type: PageRow["type"]
    slug: string
    title: string
  }>(sql`
    select r.version, r.data, p.type, p.slug::text, p.title
    from cms_revisions r join cms_pages p on p.id = r.entity_id
    where r.id = ${revisionId} and r.entity_type = 'page'`)
  const row = found.rows[0]
  if (!row) return null
  const data = pageDataSchema.safeParse(row.data)
  if (!data.success) return null
  return {
    revisionId: revisionId!,
    version: row.version,
    type: row.type,
    slug: row.slug,
    title: row.title,
    data: data.data,
    expiresAt: new Date(expires * 1000),
  }
}

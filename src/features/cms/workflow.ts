import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { systemActor, type Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { logger } from "@/server/observability/logger"
import { defineOperation } from "@/server/operation"

import {
  contentIsValid,
  lockTarget,
  parseContent,
  setDraftPointer,
  targetSchema,
  type ContentTarget,
  type Holder,
  type MenuKey,
  type PageStatus,
  type PageType,
} from "./content-target"
import { describeDiff, diffPages } from "./revision-diff"
import {
  pageDataSchema,
  type NavigationData,
  type PageData,
  type SiteSettingsData,
} from "./schemas"
import { insertRefs, insertRevision, publishRevision } from "./service"

/**
 * The CMS workflow (doc/06 Phase 6, owner decisions 2026-10-17), shared by
 * pages, menus and site settings: a working draft edited in place by
 * autosave, frozen into a numbered revision when it is submitted, scheduled
 * or published. Content Managers publish directly; Content Editors submit
 * for review.
 */

export type WorkflowStatus =
  "draft" | "in_review" | "approved" | "scheduled" | "published" | "archived"

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
const FROZEN: WorkflowStatus[] = ["in_review", "approved", "scheduled"]
const PENDING: WorkflowStatus[] = [
  "draft",
  "in_review",
  "approved",
  "scheduled",
]

async function revision(
  db: Transaction | ReturnType<typeof getDb>,
  revisionId: string | null,
  lock = false,
): Promise<RevisionRow | null> {
  if (!revisionId) return null
  const found = await db.execute<RevisionRow>(sql`
    select id, version, data, workflow_status, note, review_note, scheduled_for, updated_at
    from cms_revisions where id = ${revisionId}
    ${lock ? sql`for update` : sql``}`)
  return found.rows[0] ?? null
}

async function audit(
  tx: Transaction,
  actor: Actor,
  holder: Holder,
  action: string,
  changes?: Record<string, unknown>,
) {
  await writeAudit(tx, actor, {
    action: `cms.${holder.kind}.${action}`,
    entityType: holder.auditEntity,
    entityId: holder.entityId,
    ...(changes ? { changes } : {}),
  })
}

// --- Reads -----------------------------------------------------------------------------

/** Empty content for a target that has never been saved. */
function emptyContent(type: ContentTarget["type"]): unknown {
  if (type === "page") return { sections: [], seo: {} } satisfies PageData
  if (type === "navigation") return { items: [] } satisfies NavigationData
  return {
    brandName: "Duis",
    contact: { email: "" },
    social: {},
    defaultSeo: { title: "", description: "" },
  }
}

export type EditorState<T = unknown> = {
  target: ContentTarget
  page: (NonNullable<Holder["page"]> & { id: string }) | null
  data: T
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

export type PageEditorState = Omit<EditorState<PageData>, "page"> & {
  page: NonNullable<Holder["page"]> & { id: string }
}

export const getEditor = defineOperation({
  name: "cms.getEditor",
  access: { cms: ["read"] },
  input: z.object({ target: targetSchema }),
  async handler(_ctx, { target }): Promise<EditorState> {
    return withTransaction(async (tx) => {
      const holder = await lockTarget(tx, target, { create: true })
      const current = await revision(tx, holder.draftRevisionId)
      const valid = current ? contentIsValid(target.type, current.data) : null
      return {
        target,
        page: holder.page ? { ...holder.page, id: holder.entityId } : null,
        data: valid?.success ? valid.data : emptyContent(target.type),
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
        publishedRevisionId: holder.publishedRevisionId,
      }
    })
  },
})

// --- Editing ---------------------------------------------------------------------------

const baseSchema = z
  .object({ revisionId: z.uuid(), updatedAt: z.iso.datetime() })
  .nullable()

/**
 * Autosave. Edits the working draft in place; if the latest revision is
 * published or archived, starts a new draft from this data. `base` is what
 * the editor last loaded or saved: if someone else has saved since, nothing
 * is written and the editor is asked to reload.
 */
export const autosaveDraft = defineOperation({
  name: "cms.autosaveDraft",
  access: { cms: ["draft"] },
  input: z.object({
    target: targetSchema,
    data: z.unknown(),
    base: baseSchema,
  }),
  async handler({ actor }, { target, data: raw, base }) {
    const { data, refs } = parseContent(target.type, raw)
    return withTransaction(async (tx) => {
      const holder = await lockTarget(tx, target, { create: true })
      if (holder.page?.status === "archived")
        throw new DomainError("INVALID_STATE", "Restore the page to edit it.")
      const conflict = new DomainError(
        "CONFLICT",
        "Someone else changed this. Reload to see their version.",
      )
      if ((base?.revisionId ?? null) !== holder.draftRevisionId) throw conflict
      const latest = await revision(tx, holder.draftRevisionId, true)
      if (latest && FROZEN.includes(latest.workflow_status)) {
        throw new DomainError(
          "INVALID_STATE",
          "This version is waiting to be reviewed or published. Withdraw it or cancel the schedule to edit.",
        )
      }
      if (latest?.workflow_status === "draft") {
        if (new Date(latest.updated_at).toISOString() !== base!.updatedAt)
          throw conflict
        const updated = await tx.execute<{ updated_at: Date }>(sql`
          update cms_revisions set data = ${JSON.stringify(data)}::jsonb,
            created_by = coalesce(created_by, ${actorId(actor)}), updated_at = now()
          where id = ${latest.id} returning updated_at`)
        await tx.execute(
          sql`delete from cms_revision_refs where revision_id = ${latest.id}`,
        )
        await insertRefs(tx, latest.id, refs)
        return {
          revisionId: latest.id,
          version: latest.version,
          updatedAt: new Date(updated.rows[0]!.updated_at).toISOString(),
        }
      }
      const created = await insertRevision(
        tx,
        holder.entityType,
        holder.entityId,
        data,
        refs,
        actorId(actor),
      )
      await setDraftPointer(tx, holder, created.revisionId)
      await audit(tx, actor, holder, "draft_started", {
        version: created.version,
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

// --- Workflow --------------------------------------------------------------------------

async function draftFor(
  tx: Transaction,
  target: ContentTarget,
  allowed: WorkflowStatus[],
  message: string,
) {
  const holder = await lockTarget(tx, target)
  if (holder.page?.status === "archived")
    throw new DomainError("INVALID_STATE", "Restore the page first.")
  const current = await revision(tx, holder.draftRevisionId, true)
  if (!current || !allowed.includes(current.workflow_status))
    throw new DomainError("INVALID_STATE", message)
  return { holder, current }
}

export async function setStatus(
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
export const submitForReview = defineOperation({
  name: "cms.submitForReview",
  access: { cms: ["draft"] },
  input: z.object({
    target: targetSchema,
    note: z.string().trim().max(300).optional(),
  }),
  async handler({ actor }, { target, note }) {
    return withTransaction(async (tx) => {
      const { holder, current } = await draftFor(
        tx,
        target,
        ["draft"],
        "Only a draft can be submitted.",
      )
      parseContent(target.type, current.data)
      await setStatus(tx, current.id, "in_review", {
        note: note ?? null,
        reviewNote: null,
      })
      await audit(tx, actor, holder, "submit", {
        version: current.version,
        note,
      })
      return {}
    })
  },
})

/** Authors: take a submission back to keep editing. */
export const withdrawSubmission = defineOperation({
  name: "cms.withdrawSubmission",
  access: { cms: ["draft"] },
  input: z.object({ target: targetSchema }),
  async handler({ actor }, { target }) {
    return withTransaction(async (tx) => {
      const { holder, current } = await draftFor(
        tx,
        target,
        ["in_review"],
        "Nothing is waiting for review.",
      )
      await setStatus(tx, current.id, "draft")
      await audit(tx, actor, holder, "withdraw", { version: current.version })
      return {}
    })
  },
})

/** Managers: send a submitted draft back to its author with a reason. */
export const requestChanges = defineOperation({
  name: "cms.requestChanges",
  access: { cms: ["review"] },
  input: z.object({
    target: targetSchema,
    reviewNote: z.string().trim().min(1, "Say what needs changing.").max(500),
  }),
  async handler({ actor }, { target, reviewNote }) {
    return withTransaction(async (tx) => {
      const { holder, current } = await draftFor(
        tx,
        target,
        ["in_review"],
        "Only a submitted draft can be sent back.",
      )
      await setStatus(tx, current.id, "draft", {
        reviewNote,
        reviewedBy: actorId(actor),
      })
      await audit(tx, actor, holder, "request_changes", {
        version: current.version,
        reviewNote,
      })
      return {}
    })
  },
})

/** Managers: publish the working draft (or a submitted one) now. */
export const publishDraft = defineOperation({
  name: "cms.publishDraft",
  access: { cms: ["publish"] },
  input: z.object({ target: targetSchema }),
  async handler({ actor }, { target }) {
    const revisionId = await withTransaction(async (tx) => {
      const holder = await lockTarget(tx, target)
      if (holder.page?.status === "archived")
        throw new DomainError("INVALID_STATE", "Restore the page first.")
      const latest = await revision(tx, holder.draftRevisionId, true)
      // A page taken offline and not edited since: publish that content as
      // a new version.
      if (
        latest &&
        holder.page &&
        holder.page.status !== "published" &&
        ["published", "archived"].includes(latest.workflow_status)
      ) {
        const { data, refs } = parseContent(target.type, latest.data)
        const copy = await insertRevision(
          tx,
          holder.entityType,
          holder.entityId,
          data,
          refs,
          actorId(actor),
          `Republished version ${latest.version}`,
        )
        await setDraftPointer(tx, holder, copy.revisionId)
        return copy.revisionId
      }
      if (!latest || !PENDING.includes(latest.workflow_status))
        throw new DomainError(
          "INVALID_STATE",
          "There are no unpublished changes.",
        )
      if (latest.workflow_status === "in_review")
        await setStatus(tx, latest.id, "in_review", {
          reviewedBy: actorId(actor),
        })
      return latest.id
    })
    await publishRevision(actor, { revisionId })
    return { revisionId }
  },
})

/** Managers: publish at a set time (the worker checks every minute). */
export const scheduleDraft = defineOperation({
  name: "cms.schedule",
  access: { cms: ["publish"] },
  input: z.object({
    target: targetSchema,
    at: z.iso.datetime({ offset: true }),
  }),
  async handler({ actor }, { target, at }) {
    const when = new Date(at)
    const now = Date.now()
    const reject = (message: string) =>
      new DomainError("VALIDATION_FAILED", message, {
        issues: { at: [message] },
      })
    if (when.getTime() < now + 60_000)
      throw reject("Pick a time at least a minute from now.")
    if (when.getTime() > now + 366 * 24 * 3600_000)
      throw reject("Pick a time within the next year.")
    return withTransaction(async (tx) => {
      const { holder, current } = await draftFor(
        tx,
        target,
        PENDING,
        "There are no unpublished changes to schedule.",
      )
      parseContent(target.type, current.data)
      await setStatus(tx, current.id, "scheduled", {
        scheduledFor: when,
        ...(current.workflow_status === "in_review"
          ? { reviewedBy: actorId(actor) }
          : {}),
      })
      await audit(tx, actor, holder, "schedule", {
        version: current.version,
        at: when.toISOString(),
      })
      return { scheduledFor: when }
    })
  },
})

export const cancelSchedule = defineOperation({
  name: "cms.cancelSchedule",
  access: { cms: ["publish"] },
  input: z.object({ target: targetSchema }),
  async handler({ actor }, { target }) {
    return withTransaction(async (tx) => {
      const { holder, current } = await draftFor(
        tx,
        target,
        ["scheduled"],
        "Nothing is scheduled.",
      )
      await setStatus(tx, current.id, "draft", { scheduledFor: null })
      await audit(tx, actor, holder, "cancel_schedule", {
        version: current.version,
      })
      return {}
    })
  },
})

/** Rollback: copy an older revision into the working draft. */
export const restoreRevision = defineOperation({
  name: "cms.restoreRevision",
  access: { cms: ["draft"] },
  input: z.object({ target: targetSchema, revisionId: z.uuid() }),
  async handler({ actor }, { target, revisionId }) {
    return withTransaction(async (tx) => {
      const holder = await lockTarget(tx, target)
      const source = await tx.execute<{ data: unknown; version: number }>(sql`
        select data, version from cms_revisions
        where id = ${revisionId} and entity_type = ${holder.entityType}::cms_entity_type
          and entity_id = ${holder.entityId}`)
      const row = source.rows[0]
      if (!row) throw new DomainError("NOT_FOUND", "Revision not found.")
      const { data, refs } = parseContent(target.type, row.data)
      const latest = await revision(tx, holder.draftRevisionId, true)
      if (latest && FROZEN.includes(latest.workflow_status)) {
        throw new DomainError(
          "INVALID_STATE",
          "Withdraw the submission or cancel the schedule first.",
        )
      }
      if (latest?.workflow_status === "draft") {
        await tx.execute(sql`
          update cms_revisions set data = ${JSON.stringify(data)}::jsonb, updated_at = now()
          where id = ${latest.id}`)
        await tx.execute(
          sql`delete from cms_revision_refs where revision_id = ${latest.id}`,
        )
        await insertRefs(tx, latest.id, refs)
      } else {
        const created = await insertRevision(
          tx,
          holder.entityType,
          holder.entityId,
          data,
          refs,
          actorId(actor),
          `Restored from version ${row.version}`,
        )
        await setDraftPointer(tx, holder, created.revisionId)
      }
      await audit(tx, actor, holder, "restore_revision", {
        fromVersion: row.version,
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

export const listRevisions = defineOperation({
  name: "cms.listRevisions",
  access: { cms: ["read"] },
  input: z.object({ target: targetSchema }),
  async handler(_ctx, { target }): Promise<RevisionSummary[]> {
    const holder = await withTransaction((tx) =>
      lockTarget(tx, target, { create: true }),
    )
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
    }>(sql`
      select r.id, r.version, r.data, r.workflow_status, a.name as author, v.name as reviewer,
             pb.name as publisher, r.note, r.review_note, r.scheduled_for, r.published_at,
             r.updated_at
      from cms_revisions r
      left join users a on a.id = r.created_by
      left join users v on v.id = r.reviewed_by
      left join users pb on pb.id = r.published_by
      where r.entity_type = ${holder.entityType}::cms_entity_type and r.entity_id = ${holder.entityId}
      order by r.version desc
      limit 100`)
    const ordered = [...rows.rows].reverse()
    return ordered
      .map((row, i): RevisionSummary => {
        let changes: string
        if (target.type === "page") {
          const data = pageDataSchema.safeParse(row.data)
          const before =
            i > 0 ? pageDataSchema.safeParse(ordered[i - 1]!.data) : null
          changes =
            data.success && (i === 0 || before?.success)
              ? describeDiff(
                  diffPages(before?.success ? before.data : null, data.data),
                  i === 0,
                )
              : "Content from an older format"
        } else {
          changes =
            i === 0
              ? "First version"
              : JSON.stringify(row.data) ===
                  JSON.stringify(ordered[i - 1]!.data)
                ? "No changes"
                : "Edited"
        }
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
          live: row.id === holder.publishedRevisionId,
          changes,
        }
      })
      .reverse()
  },
})

export type ScheduledItem = {
  revisionId: string
  label: string
  href: string
  version: number
  scheduledFor: Date
  scheduledBy: string | null
}

const MENU_LABELS: Record<MenuKey, string> = {
  header: "Header menu",
  footer: "Footer menu",
  mobile: "Mobile menu",
  social: "Social links",
}

export const listScheduled = defineOperation({
  name: "cms.listScheduled",
  access: { cms: ["read"] },
  input: z.object({}),
  async handler(): Promise<ScheduledItem[]> {
    const rows = await getDb().execute<{
      revision_id: string
      entity_type: "page" | "navigation" | "site_settings" | "blog_post"
      entity_id: string
      title: string | null
      menu_key: MenuKey | null
      version: number
      scheduled_for: Date
      scheduled_by: string | null
    }>(sql`
      select r.id as revision_id, r.entity_type, r.entity_id, p.title, m.key::text as menu_key,
             r.version, r.scheduled_for,
             (select u.name from audit_logs l join users u on u.id = l.actor_user_id
              where l.entity_id = r.entity_id::text and l.action like 'cms.%.schedule'
              order by l.created_at desc limit 1) as scheduled_by
      from cms_revisions r
      left join cms_pages p on r.entity_type = 'page' and p.id = r.entity_id
      left join navigation_menus m on r.entity_type = 'navigation' and m.id = r.entity_id
      where r.workflow_status = 'scheduled'
      order by r.scheduled_for`)
    return rows.rows.map((r) => ({
      revisionId: r.revision_id,
      label:
        r.entity_type === "page"
          ? (r.title ?? "Page")
          : r.entity_type === "navigation"
            ? MENU_LABELS[r.menu_key ?? "header"]
            : "Site settings",
      href:
        r.entity_type === "page"
          ? `/admin/cms/pages/${r.entity_id}`
          : r.entity_type === "navigation"
            ? `/admin/cms/navigation/${r.menu_key}`
            : "/admin/cms/settings",
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
    const found = await getDb().execute<{ id: string }>(sql`
      select id from cms_revisions
      where id = ${revisionId} and entity_type in ('page', 'navigation', 'site_settings')`)
    if (!found.rows[0])
      throw new DomainError("NOT_FOUND", "Revision not found.")
    const expires = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS
    const token = `${revisionId}.${expires}.${previewSignature(revisionId, expires)}`
    return { path: `/preview/${token}`, expiresAt: new Date(expires * 1000) }
  },
})

type PreviewBase = { revisionId: string; version: number; expiresAt: Date }

export type PreviewPage =
  | (PreviewBase & {
      kind: "page"
      type: PageType
      slug: string
      title: string
      data: PageData
    })
  | (PreviewBase & { kind: "navigation"; key: MenuKey; data: NavigationData })
  | (PreviewBase & { kind: "site_settings"; data: SiteSettingsData })

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
    entity_type: "page" | "navigation" | "site_settings"
    page_type: PageType | null
    slug: string | null
    title: string | null
    menu_key: MenuKey | null
  }>(sql`
    select r.version, r.data, r.entity_type, p.type as page_type, p.slug::text, p.title,
           m.key::text as menu_key
    from cms_revisions r
    left join cms_pages p on r.entity_type = 'page' and p.id = r.entity_id
    left join navigation_menus m on r.entity_type = 'navigation' and m.id = r.entity_id
    where r.id = ${revisionId}`)
  const row = found.rows[0]
  if (!row) return null
  const valid = contentIsValid(row.entity_type, row.data)
  if (!valid.success) return null
  const base = {
    revisionId: revisionId!,
    version: row.version,
    expiresAt: new Date(expires * 1000),
  }
  if (row.entity_type === "page")
    return {
      ...base,
      kind: "page",
      type: row.page_type!,
      slug: row.slug!,
      title: row.title!,
      data: valid.data as PageData,
    }
  if (row.entity_type === "navigation")
    return {
      ...base,
      kind: "navigation",
      key: row.menu_key!,
      data: valid.data as NavigationData,
    }
  return {
    ...base,
    kind: "site_settings",
    data: valid.data as SiteSettingsData,
  }
}

export type { PageStatus }

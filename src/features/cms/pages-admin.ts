import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { loadCatalogTree, loadMediaRefs } from "@/features/catalog"
import { recordAddressChange, releaseAddress } from "@/features/redirects"
import { slugSchema } from "@/lib/slug-schema"
import type { Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { emptyRefs, type ContentRefs } from "./blocks"
import {
  contentIsValid,
  lockTarget,
  parseContent,
  type ContentTarget,
  type Holder,
  type PageStatus,
  type PageType,
} from "./content-target"
import { pageHref } from "./resolve"
import { setStatus, type WorkflowStatus } from "./workflow"

/** Page-only operations: the list, names, addresses and going offline. */

export type AdminPageRow = {
  id: string
  type: PageType
  slug: string
  title: string
  status: PageStatus
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
      type: PageType
      slug: string
      title: string
      status: PageStatus
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
    // Waiting work across pages, menus and settings.
    const counts = await getDb().execute<{ review: number; scheduled: number }>(
      sql`
        select count(*) filter (where r.workflow_status = 'in_review')::int as review,
               count(*) filter (where r.workflow_status = 'scheduled')::int as scheduled
        from cms_revisions r
        left join cms_pages p on r.entity_type = 'page' and p.id = r.entity_id
        where r.workflow_status in ('in_review', 'scheduled')
          and (r.entity_type <> 'page' or (p.status <> 'archived' and p.draft_revision_id = r.id))`,
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

/**
 * Names and thumbnails for the editors: everything the content points at,
 * and the collections and categories it can choose from.
 */
export async function loadEditorLabels(refs: ContentRefs) {
  const [media, products, collections, tree, pages] = await Promise.all([
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
    getDb().execute<{ slug: string; title: string }>(sql`
      select slug::text, title from cms_pages where status <> 'archived' and type <> 'home' order by title`),
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
    pages: pages.rows.map((p) => ({ id: p.slug, label: p.title })),
  }
}

/** Labels for whatever a target's content currently points at. */
export async function editorLabelsFor(
  type: ContentTarget["type"],
  data: unknown,
) {
  const refs = contentIsValid(type, data).success
    ? parseContent(type, data).refs
    : emptyRefs()
  return loadEditorLabels(refs)
}

async function lockPage(tx: Transaction, pageId: string) {
  const holder = await lockTarget(tx, { type: "page", id: pageId })
  return holder as Holder & { page: NonNullable<Holder["page"]> }
}

/** Title changes apply straight away. */
export const renamePage = defineOperation({
  name: "cms.renamePage",
  access: { cms: ["draft"] },
  input: z.object({
    pageId: z.uuid(),
    title: z.string().trim().min(1).max(120),
  }),
  async handler({ actor }, { pageId, title }) {
    return withTransaction(async (tx) => {
      const holder = await lockPage(tx, pageId)
      await tx.execute(
        sql`update cms_pages set title = ${title}, updated_at = now() where id = ${pageId}`,
      )
      await requestRevalidation(
        [cacheTags.cmsPage(holder.page.slug), cacheTags.cmsPagesList],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "cms.page.rename",
        entityType: "cms_page",
        entityId: pageId,
        changes: { from: holder.page.title, to: title },
      })
      return {}
    })
  },
})

/**
 * A new web address. If the page has ever been live, the old address
 * redirects permanently (owner decision 2026-10-17).
 */
export const changePageSlug = defineOperation({
  name: "cms.changePageSlug",
  access: { cms: ["publish"] },
  input: z.object({ pageId: z.uuid(), slug: slugSchema }),
  async handler({ actor }, { pageId, slug }) {
    return withTransaction(async (tx) => {
      const holder = await lockPage(tx, pageId)
      const old = holder.page.slug
      if (holder.page.type === "home")
        throw new DomainError("INVALID_STATE", "The home page is always /.")
      if (old === slug) return { slug }
      await tx
        .execute(
          sql`update cms_pages set slug = ${slug}, updated_at = now() where id = ${pageId}`,
        )
        .catch((error) => {
          if (isUniqueViolation(error))
            throw new DomainError(
              "CONFLICT",
              "Another page uses that address.",
              {
                issues: { slug: ["Another page uses that address."] },
              },
            )
          throw error
        })
      if (holder.page.publishedAt) {
        await recordAddressChange(tx, pageHref(old), pageHref(slug))
      } else {
        await releaseAddress(tx, pageHref(slug))
      }
      await requestRevalidation(
        [
          cacheTags.cmsPage(old),
          cacheTags.cmsPage(slug),
          cacheTags.cmsPagesList,
        ],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "cms.page.change_slug",
        entityType: "cms_page",
        entityId: pageId,
        changes: { from: old, to: slug },
      })
      return { slug }
    })
  },
})

async function takeOffline(
  tx: Transaction,
  actor: Actor,
  holder: Holder & { page: NonNullable<Holder["page"]> },
  status: "draft" | "archived",
) {
  if (holder.page.type === "home")
    throw new DomainError("INVALID_STATE", "The home page is always live.")
  if (holder.publishedRevisionId) {
    await setStatus(tx, holder.publishedRevisionId, "archived")
  }
  // A pending schedule would put it back online.
  await tx.execute(sql`
    update cms_revisions set workflow_status = 'draft', scheduled_for = null, updated_at = now()
    where entity_type = 'page' and entity_id = ${holder.entityId} and workflow_status = 'scheduled'`)
  await tx.execute(sql`
    update cms_pages set status = ${status}::publication_status, published_revision_id = null,
      updated_at = now()
    where id = ${holder.entityId}`)
  await requestRevalidation(
    [cacheTags.cmsPage(holder.page.slug), cacheTags.cmsPagesList],
    { tx },
  )
  await writeAudit(tx, actor, {
    action: status === "archived" ? "cms.page.archive" : "cms.page.unpublish",
    entityType: "cms_page",
    entityId: holder.entityId,
    changes: { slug: holder.page.slug },
  })
}

/** Takes the page off the site; its content stays for re-publishing. */
export const unpublishPage = defineOperation({
  name: "cms.unpublishPage",
  access: { cms: ["publish"] },
  input: z.object({ pageId: z.uuid() }),
  async handler({ actor }, { pageId }) {
    return withTransaction(async (tx) => {
      const holder = await lockPage(tx, pageId)
      if (holder.page.status !== "published")
        throw new DomainError("INVALID_STATE", "The page isn't live.")
      await takeOffline(tx, actor, holder, "draft")
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
      const holder = await lockPage(tx, pageId)
      if (holder.page.status === "archived") return {}
      await takeOffline(tx, actor, holder, "archived")
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
      const holder = await lockPage(tx, pageId)
      if (holder.page.status !== "archived") return {}
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

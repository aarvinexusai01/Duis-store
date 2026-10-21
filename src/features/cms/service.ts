import "server-only"
import { and, eq, sql } from "drizzle-orm"

import {
  cmsPages,
  cmsRevisionRefs,
  cmsRevisions,
  navigationMenus,
  siteSettings,
} from "@/db/schema"
import { releaseAddress } from "@/features/redirects"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { collectBlockRefs, emptyRefs, type ContentRefs } from "./blocks"
import { pageHref } from "./resolve"
import {
  createPageSchema,
  navigationDataSchema,
  pageDataSchema,
  publishRevisionSchema,
  saveNavigationDraftSchema,
  savePageDraftSchema,
  saveSiteSettingsDraftSchema,
  siteSettingsDataSchema,
  type NavigationData,
  type NavItem,
  type PageData,
  type SiteSettingsData,
} from "./schemas"

type EntityType = "page" | "navigation" | "site_settings"

export function pageRefs(data: PageData): ContentRefs {
  const refs = emptyRefs()
  data.sections.forEach((section) => collectBlockRefs(section, refs))
  if (data.seo.ogMediaId) refs.mediaIds.add(data.seo.ogMediaId)
  return refs
}

export function navigationRefs(data: NavigationData): ContentRefs {
  const refs = emptyRefs()
  const visit = (item: NavItem) => {
    if (item.link.type === "category")
      refs.categoryIds.add(item.link.categoryId)
    if (item.link.type === "collection")
      refs.collectionIds.add(item.link.collectionId)
    if (item.link.type === "product") refs.productIds.add(item.link.productId)
    if (item.promoMediaId) refs.mediaIds.add(item.promoMediaId)
    item.children?.forEach(visit)
  }
  data.items.forEach(visit)
  return refs
}

export function settingsRefs(data: SiteSettingsData): ContentRefs {
  const refs = emptyRefs()
  if (data.logoMediaId) refs.mediaIds.add(data.logoMediaId)
  if (data.faviconMediaId) refs.mediaIds.add(data.faviconMediaId)
  if (data.defaultSeo.ogMediaId) refs.mediaIds.add(data.defaultSeo.ogMediaId)
  return refs
}

/** Inserts a numbered revision and its reference rows. */
export async function insertRevision(
  tx: Transaction,
  entityType: EntityType,
  entityId: string,
  data: unknown,
  refs: ContentRefs,
  createdBy: string | null,
  note?: string,
) {
  // Serialise version numbers per entity.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`cms:${entityType}:${entityId}`}))`,
  )
  const [{ next = 1 } = {}] = await tx
    .select({
      next: sql<number>`coalesce(max(${cmsRevisions.version}), 0)::int + 1`,
    })
    .from(cmsRevisions)
    .where(
      and(
        eq(cmsRevisions.entityType, entityType),
        eq(cmsRevisions.entityId, entityId),
      ),
    )

  const [revision] = await tx
    .insert(cmsRevisions)
    .values({
      entityType,
      entityId,
      version: next,
      data,
      createdBy,
      note: note ?? null,
    })
    .returning({ id: cmsRevisions.id, version: cmsRevisions.version })

  await insertRefs(tx, revision!.id, refs)
  return { revisionId: revision!.id, version: revision!.version }
}

/** Indexes what a revision points at (cms_revision_refs). */
export async function insertRefs(
  tx: Transaction,
  revisionId: string,
  refs: ContentRefs,
) {
  const rows = [
    ...[...refs.productIds].map((productId) => ({ revisionId, productId })),
    ...[...refs.collectionIds].map((collectionId) => ({
      revisionId,
      collectionId,
    })),
    ...[...refs.categoryIds].map((categoryId) => ({ revisionId, categoryId })),
    ...[...refs.mediaIds].map((mediaId) => ({ revisionId, mediaId })),
  ]
  if (rows.length > 0) {
    await tx
      .insert(cmsRevisionRefs)
      .values(rows)
      .catch((err) => {
        if ((err as { cause?: { code?: string } }).cause?.code === "23503") {
          throw new DomainError(
            "VALIDATION_FAILED",
            "This content links to something that no longer exists.",
          )
        }
        throw err
      })
  }
}

const actorId = (actor: { kind: string; userId?: string }) =>
  actor.kind === "user" ? (actor.userId ?? null) : null

export const createPage = defineOperation({
  name: "cms.createPage",
  access: { cms: ["draft"] },
  input: createPageSchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const [page] = await tx
        .insert(cmsPages)
        .values({ ...input, createdBy: actorId(actor) })
        .returning({ id: cmsPages.id })
        .catch((err) => {
          if (isUniqueViolation(err))
            throw new DomainError("CONFLICT", "A page with that slug exists.")
          throw err
        })
      await releaseAddress(tx, pageHref(input.slug))
      await writeAudit(tx, actor, {
        action: "cms.page.create",
        entityType: "cms_page",
        entityId: page!.id,
        changes: input,
      })
      return { id: page!.id }
    })
  },
})

export const savePageDraft = defineOperation({
  name: "cms.savePageDraft",
  access: { cms: ["draft"] },
  input: savePageDraftSchema,
  async handler({ actor }, { pageId, data, note }) {
    return withTransaction(async (tx) => {
      const [page] = await tx
        .select({ id: cmsPages.id })
        .from(cmsPages)
        .where(eq(cmsPages.id, pageId))
        .for("update")
      if (!page) throw new DomainError("NOT_FOUND", "Page not found.")
      const revision = await insertRevision(
        tx,
        "page",
        pageId,
        data,
        pageRefs(data),
        actorId(actor),
        note,
      )
      await tx
        .update(cmsPages)
        .set({ draftRevisionId: revision.revisionId })
        .where(eq(cmsPages.id, pageId))
      await writeAudit(tx, actor, {
        action: "cms.page.save_draft",
        entityType: "cms_page",
        entityId: pageId,
        changes: { version: revision.version, sections: data.sections.length },
      })
      return revision
    })
  },
})

export const saveNavigationDraft = defineOperation({
  name: "cms.saveNavigationDraft",
  access: { cms: ["draft"] },
  input: saveNavigationDraftSchema,
  async handler({ actor }, { key, name, data, note }) {
    return withTransaction(async (tx) => {
      const [menu] = await tx
        .insert(navigationMenus)
        .values({ key, name: name ?? key })
        .onConflictDoUpdate({
          target: navigationMenus.key,
          set: name ? { name } : { key },
        })
        .returning({ id: navigationMenus.id })
      const revision = await insertRevision(
        tx,
        "navigation",
        menu!.id,
        data,
        navigationRefs(data),
        actorId(actor),
        note,
      )
      await tx
        .update(navigationMenus)
        .set({ draftRevisionId: revision.revisionId })
        .where(eq(navigationMenus.id, menu!.id))
      await writeAudit(tx, actor, {
        action: "cms.navigation.save_draft",
        entityType: "navigation_menu",
        entityId: menu!.id,
        changes: { key, version: revision.version },
      })
      return revision
    })
  },
})

export const saveSiteSettingsDraft = defineOperation({
  name: "cms.saveSiteSettingsDraft",
  access: { cms: ["draft"] },
  input: saveSiteSettingsDraftSchema,
  async handler({ actor }, { data, note }) {
    return withTransaction(async (tx) => {
      const [settings] = await tx
        .insert(siteSettings)
        .values({ id: 1 })
        .onConflictDoUpdate({ target: siteSettings.id, set: { id: 1 } })
        .returning({ entityId: siteSettings.entityId })
      const revision = await insertRevision(
        tx,
        "site_settings",
        settings!.entityId,
        data,
        settingsRefs(data),
        actorId(actor),
        note,
      )
      await tx
        .update(siteSettings)
        .set({ draftRevisionId: revision.revisionId })
        .where(eq(siteSettings.id, 1))
      await writeAudit(tx, actor, {
        action: "cms.settings.save_draft",
        entityType: "site_settings",
        entityId: settings!.entityId,
        changes: { version: revision.version },
      })
      return revision
    })
  },
})

/**
 * Makes a revision live. Idempotent; the previously live revision is
 * archived. Content is re-validated in case the schema tightened since the
 * draft was saved. (Review and scheduling arrive with the CMS UI in Phase 6.)
 */
export const publishRevision = defineOperation({
  name: "cms.publishRevision",
  access: { cms: ["publish"] },
  input: publishRevisionSchema,
  async handler({ actor }, { revisionId }) {
    return withTransaction(async (tx) => {
      const [revision] = await tx
        .select()
        .from(cmsRevisions)
        .where(eq(cmsRevisions.id, revisionId))
        .for("update")
      if (!revision) throw new DomainError("NOT_FOUND", "Revision not found.")
      if (revision.workflowStatus === "published")
        return { revisionId, alreadyPublished: true }
      if (revision.workflowStatus === "archived") {
        throw new DomainError(
          "INVALID_STATE",
          "Archived revisions cannot be published; restore it as a new draft.",
        )
      }

      let previous: string | null = null
      let tags: string[] = []
      const now = new Date()

      if (revision.entityType === "page") {
        pageDataSchema.parse(revision.data)
        const [page] = await tx
          .select()
          .from(cmsPages)
          .where(eq(cmsPages.id, revision.entityId))
          .for("update")
        if (!page) throw new DomainError("NOT_FOUND", "Page not found.")
        previous = page.publishedRevisionId
        await tx
          .update(cmsPages)
          .set({
            publishedRevisionId: revisionId,
            status: "published",
            publishedAt: now,
          })
          .where(eq(cmsPages.id, page.id))
        tags = [cacheTags.cmsPage(page.slug), cacheTags.cmsPagesList]
      } else if (revision.entityType === "navigation") {
        navigationDataSchema.parse(revision.data)
        const [menu] = await tx
          .select()
          .from(navigationMenus)
          .where(eq(navigationMenus.id, revision.entityId))
          .for("update")
        if (!menu) throw new DomainError("NOT_FOUND", "Menu not found.")
        previous = menu.publishedRevisionId
        await tx
          .update(navigationMenus)
          .set({ publishedRevisionId: revisionId })
          .where(eq(navigationMenus.id, menu.id))
        tags = [cacheTags.cmsNavigation]
      } else if (revision.entityType === "site_settings") {
        siteSettingsDataSchema.parse(revision.data)
        const [settings] = await tx
          .select()
          .from(siteSettings)
          .where(eq(siteSettings.id, 1))
          .for("update")
        previous = settings?.publishedRevisionId ?? null
        await tx
          .update(siteSettings)
          .set({ publishedRevisionId: revisionId })
          .where(eq(siteSettings.id, 1))
        tags = [cacheTags.cmsSettings]
      } else {
        throw new DomainError(
          "INVALID_STATE",
          "Blog publishing arrives with the blog module.",
        )
      }

      if (previous && previous !== revisionId) {
        await tx
          .update(cmsRevisions)
          .set({ workflowStatus: "archived" })
          .where(eq(cmsRevisions.id, previous))
      }
      await tx
        .update(cmsRevisions)
        .set({
          workflowStatus: "published",
          publishedAt: now,
          publishedBy: actorId(actor),
        })
        .where(eq(cmsRevisions.id, revisionId))

      await requestRevalidation(tags, { tx })
      await writeAudit(tx, actor, {
        action: "cms.publish",
        entityType: `cms_${revision.entityType}`,
        entityId: revision.entityId,
        changes: { revisionId, version: revision.version, replaced: previous },
      })
      return { revisionId, alreadyPublished: false }
    })
  },
})

// --- Reads (uncached; queries.ts adds caching for the storefront) ----------

export type PublishedPage = {
  id: string
  type: "home" | "landing" | "static" | "policy"
  slug: string
  title: string
  publishedAt: Date | null
  data: PageData
}

export async function loadPublishedPage(
  slug: string,
): Promise<PublishedPage | null> {
  const [row] = await getDb()
    .select({
      id: cmsPages.id,
      type: cmsPages.type,
      slug: cmsPages.slug,
      title: cmsPages.title,
      publishedAt: cmsPages.publishedAt,
      data: cmsRevisions.data,
    })
    .from(cmsPages)
    .innerJoin(cmsRevisions, eq(cmsRevisions.id, cmsPages.publishedRevisionId))
    .where(and(eq(cmsPages.slug, slug), eq(cmsPages.status, "published")))
  if (!row) return null
  return { ...row, data: pageDataSchema.parse(row.data) }
}

export async function loadPublishedNavigation(
  key: string,
): Promise<NavigationData | null> {
  const [row] = await getDb()
    .select({ data: cmsRevisions.data })
    .from(navigationMenus)
    .innerJoin(
      cmsRevisions,
      eq(cmsRevisions.id, navigationMenus.publishedRevisionId),
    )
    .where(eq(navigationMenus.key, key))
  return row ? navigationDataSchema.parse(row.data) : null
}

export async function loadPublishedSiteSettings(): Promise<SiteSettingsData | null> {
  const [row] = await getDb()
    .select({ data: cmsRevisions.data })
    .from(siteSettings)
    .innerJoin(
      cmsRevisions,
      eq(cmsRevisions.id, siteSettings.publishedRevisionId),
    )
    .where(eq(siteSettings.id, 1))
  return row ? siteSettingsDataSchema.parse(row.data) : null
}

/** Published, indexable pages for the sitemap (the homepage is listed as "/"). */
export async function loadPublishedPageList(): Promise<
  { slug: string; publishedAt: Date | null }[]
> {
  const rows = await getDb()
    .select({
      slug: cmsPages.slug,
      publishedAt: cmsPages.publishedAt,
      data: cmsRevisions.data,
    })
    .from(cmsPages)
    .innerJoin(cmsRevisions, eq(cmsRevisions.id, cmsPages.publishedRevisionId))
    .where(eq(cmsPages.status, "published"))
  return rows
    .filter((row) => !pageDataSchema.safeParse(row.data).data?.seo.noindex)
    .map(({ slug, publishedAt }) => ({ slug, publishedAt }))
}

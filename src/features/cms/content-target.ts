import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import type { Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"

import type { ContentRefs } from "./blocks"
import {
  navigationDataSchema,
  pageDataSchema,
  siteSettingsDataSchema,
} from "./schemas"
import { navigationRefs, pageRefs, settingsRefs } from "./service"

/**
 * What the CMS workflow can act on (doc/06 Phase 6, owner decision
 * 2026-10-17): pages, the four menus and the site settings all share one
 * lifecycle of draft, review, schedule and publish.
 */

export const MENU_KEYS = ["header", "footer", "mobile", "social"] as const
export type MenuKey = (typeof MENU_KEYS)[number]

export const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page"), id: z.uuid() }),
  z.object({ type: z.literal("navigation"), key: z.enum(MENU_KEYS) }),
  z.object({ type: z.literal("site_settings") }),
])
export type ContentTarget = z.infer<typeof targetSchema>

export type PageType = "home" | "landing" | "static" | "policy"
export type PageStatus = "draft" | "published" | "archived"

/** The row that points at a target's draft and live revisions. */
export type Holder = {
  entityType: "page" | "navigation" | "site_settings"
  entityId: string
  draftRevisionId: string | null
  publishedRevisionId: string | null
  /** For audit entries: cms.<kind>.<action> on <auditEntity>. */
  kind: "page" | "navigation" | "settings"
  auditEntity: "cms_page" | "navigation_menu" | "site_settings"
  page?: {
    type: PageType
    slug: string
    title: string
    status: PageStatus
    publishedAt: Date | null
  }
}

const MENU_NAMES: Record<MenuKey, string> = {
  header: "Header menu",
  footer: "Footer menu",
  mobile: "Mobile menu",
  social: "Social links",
}

/**
 * Locks the target's pointer row (creating a menu or the settings row on
 * first use when `create` is set). Pages must already exist.
 */
export async function lockTarget(
  tx: Transaction,
  target: ContentTarget,
  { create = false }: { create?: boolean } = {},
): Promise<Holder> {
  switch (target.type) {
    case "page": {
      const found = await tx.execute<{
        id: string
        type: PageType
        slug: string
        title: string
        status: PageStatus
        draft_revision_id: string | null
        published_revision_id: string | null
        published_at: Date | null
      }>(sql`
        select id, type, slug::text, title, status, draft_revision_id, published_revision_id, published_at
        from cms_pages where id = ${target.id} for update`)
      const row = found.rows[0]
      if (!row) throw new DomainError("NOT_FOUND", "Page not found.")
      return {
        entityType: "page",
        entityId: row.id,
        draftRevisionId: row.draft_revision_id,
        publishedRevisionId: row.published_revision_id,
        kind: "page",
        auditEntity: "cms_page",
        page: {
          type: row.type,
          slug: row.slug,
          title: row.title,
          status: row.status,
          publishedAt: row.published_at,
        },
      }
    }
    case "navigation": {
      if (create) {
        await tx.execute(sql`
          insert into navigation_menus (key, name) values (${target.key}, ${MENU_NAMES[target.key]})
          on conflict (key) do nothing`)
      }
      const found = await tx.execute<{
        id: string
        draft_revision_id: string | null
        published_revision_id: string | null
      }>(sql`
        select id, draft_revision_id, published_revision_id
        from navigation_menus where key = ${target.key} for update`)
      const row = found.rows[0]
      if (!row) throw new DomainError("NOT_FOUND", "Menu not found.")
      return {
        entityType: "navigation",
        entityId: row.id,
        draftRevisionId: row.draft_revision_id,
        publishedRevisionId: row.published_revision_id,
        kind: "navigation",
        auditEntity: "navigation_menu",
      }
    }
    case "site_settings": {
      if (create) {
        await tx.execute(
          sql`insert into site_settings (id) values (1) on conflict (id) do nothing`,
        )
      }
      const found = await tx.execute<{
        entity_id: string
        draft_revision_id: string | null
        published_revision_id: string | null
      }>(sql`
        select entity_id, draft_revision_id, published_revision_id
        from site_settings where id = 1 for update`)
      const row = found.rows[0]
      if (!row) throw new DomainError("NOT_FOUND", "Site settings not found.")
      return {
        entityType: "site_settings",
        entityId: row.entity_id,
        draftRevisionId: row.draft_revision_id,
        publishedRevisionId: row.published_revision_id,
        kind: "settings",
        auditEntity: "site_settings",
      }
    }
  }
}

/** Points the target at a new working draft. */
export async function setDraftPointer(
  tx: Transaction,
  holder: Holder,
  revisionId: string,
) {
  switch (holder.entityType) {
    case "page":
      await tx.execute(
        sql`update cms_pages set draft_revision_id = ${revisionId}, updated_at = now() where id = ${holder.entityId}`,
      )
      return
    case "navigation":
      await tx.execute(
        sql`update navigation_menus set draft_revision_id = ${revisionId}, updated_at = now() where id = ${holder.entityId}`,
      )
      return
    case "site_settings":
      await tx.execute(
        sql`update site_settings set draft_revision_id = ${revisionId}, updated_at = now() where id = 1`,
      )
      return
  }
}

/** Validates content for a target's kind (the same rules as publishing). */
export function parseContent(
  type: ContentTarget["type"],
  data: unknown,
): { data: unknown; refs: ContentRefs } {
  const schema =
    type === "page"
      ? pageDataSchema
      : type === "navigation"
        ? navigationDataSchema
        : siteSettingsDataSchema
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Check the highlighted fields.",
      {
        issues: z.flattenError(parsed.error as z.ZodError<unknown>).fieldErrors,
      },
    )
  }
  const refs =
    type === "page"
      ? pageRefs(parsed.data as z.infer<typeof pageDataSchema>)
      : type === "navigation"
        ? navigationRefs(parsed.data as z.infer<typeof navigationDataSchema>)
        : settingsRefs(parsed.data as z.infer<typeof siteSettingsDataSchema>)
  return { data: parsed.data, refs }
}

/** Whether a stored revision still matches its kind's rules. */
export function contentIsValid(type: ContentTarget["type"], data: unknown) {
  const schema =
    type === "page"
      ? pageDataSchema
      : type === "navigation"
        ? navigationDataSchema
        : siteSettingsDataSchema
  return schema.safeParse(data)
}

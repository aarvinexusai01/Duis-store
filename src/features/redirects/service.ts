import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { fromPathSchema, normalizePath, toPathSchema } from "./paths"

/**
 * Redirects (doc/06 Phase 6b, owner decision 2026-10-17). Changing an
 * address adds one automatically; staff manage their own. Chains collapse
 * on write, so a visitor is never sent through two hops.
 */

/**
 * Called inside the transaction that changes an address. Points older
 * redirects at the new address too, and drops any redirect away from the
 * new address (it now has real content).
 */
export async function recordAddressChange(
  tx: Transaction,
  from: string,
  to: string,
): Promise<void> {
  const fromPath = normalizePath(from)
  const toPath = normalizePath(to)
  if (fromPath === toPath || fromPath === "/") return
  await tx.execute(sql`delete from redirects where from_path = ${toPath}`)
  await tx.execute(sql`
    update redirects set to_path = ${toPath}, updated_at = now()
    where to_path = ${fromPath}`)
  // A redirect may now point at itself after collapsing.
  await tx.execute(sql`delete from redirects where from_path = to_path`)
  await tx.execute(sql`
    insert into redirects (from_path, to_path, status_code, source)
    values (${fromPath}, ${toPath}, 301, 'auto')
    on conflict (from_path) do update
      set to_path = excluded.to_path, status_code = 301, source = 'auto', updated_at = now()`)
}

/** New content now lives at `path`: stop redirecting it elsewhere. */
export async function releaseAddress(
  tx: Transaction,
  path: string,
): Promise<void> {
  await tx.execute(
    sql`delete from redirects where from_path = ${normalizePath(path)}`,
  )
}

export type RedirectRow = {
  id: string
  fromPath: string
  toPath: string
  statusCode: 301 | 302
  source: "auto" | "manual"
  hits: number
  lastHitAt: Date | null
  createdAt: Date
}

export const REDIRECTS_PAGE_SIZE = 100

export const adminListRedirects = defineOperation({
  name: "redirects.adminList",
  access: { cms: ["read"] },
  input: z.object({
    q: z.string().trim().max(200).optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, { q, page }) {
    const like = q ? `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%` : null
    const rows = await getDb().execute<{
      id: string
      from_path: string
      to_path: string
      status_code: 301 | 302
      source: "auto" | "manual"
      hits: number
      last_hit_at: Date | null
      created_at: Date
      total: number
    }>(sql`
      select id, from_path, to_path, status_code, source, hits, last_hit_at, created_at,
             count(*) over ()::int as total
      from redirects
      where ${like}::text is null or from_path like ${like} or lower(to_path) like ${like}
      order by created_at desc
      limit ${REDIRECTS_PAGE_SIZE} offset ${(page - 1) * REDIRECTS_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r): RedirectRow => ({
        id: r.id,
        fromPath: r.from_path,
        toPath: r.to_path,
        statusCode: r.status_code,
        source: r.source,
        hits: r.hits,
        lastHitAt: r.last_hit_at,
        createdAt: r.created_at,
      })),
    }
  },
})

export const createRedirect = defineOperation({
  name: "redirects.create",
  access: { cms: ["publish"] },
  input: z.object({
    fromPath: fromPathSchema,
    toPath: toPathSchema,
    permanent: z.boolean().default(true),
  }),
  async handler({ actor }, { fromPath, toPath, permanent }) {
    if (normalizePath(toPath) === fromPath)
      throw new DomainError(
        "VALIDATION_FAILED",
        "A redirect can't point at itself.",
        {
          issues: { toPath: ["A redirect can't point at itself."] },
        },
      )
    return withTransaction(async (tx) => {
      // Would this create a loop through an existing redirect?
      const next = await tx.execute<{ to_path: string }>(sql`
        select to_path from redirects where from_path = ${normalizePath(toPath)}`)
      if (next.rows[0] && normalizePath(next.rows[0].to_path) === fromPath) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "That would send visitors round in a loop.",
          { issues: { toPath: ["That would send visitors round in a loop."] } },
        )
      }
      const inserted = await tx
        .execute<{ id: string }>(
          sql`
          insert into redirects (from_path, to_path, status_code, source, created_by)
          values (${fromPath}, ${toPath}, ${permanent ? 301 : 302}, 'manual',
                  ${actor.kind === "user" ? actor.userId : null})
          returning id`,
        )
        .catch((error) => {
          if (isUniqueViolation(error))
            throw new DomainError(
              "CONFLICT",
              "That address already redirects somewhere.",
              {
                issues: {
                  fromPath: ["That address already redirects somewhere."],
                },
              },
            )
          throw error
        })
      const id = inserted.rows[0]!.id
      await writeAudit(tx, actor, {
        action: "redirect.create",
        entityType: "redirect",
        entityId: id,
        changes: { fromPath, toPath, permanent },
      })
      return { id }
    })
  },
})

export const deleteRedirect = defineOperation({
  name: "redirects.delete",
  access: { cms: ["publish"] },
  input: z.object({ id: z.uuid() }),
  async handler({ actor }, { id }) {
    return withTransaction(async (tx) => {
      const removed = await tx.execute<{ from_path: string; to_path: string }>(
        sql`delete from redirects where id = ${id} returning from_path, to_path`,
      )
      const row = removed.rows[0]
      if (!row) throw new DomainError("NOT_FOUND", "Redirect not found.")
      await writeAudit(tx, actor, {
        action: "redirect.delete",
        entityType: "redirect",
        entityId: id,
        changes: { fromPath: row.from_path, toPath: row.to_path },
      })
      return {}
    })
  },
})

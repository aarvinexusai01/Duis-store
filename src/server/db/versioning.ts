import "server-only"
import { sql } from "drizzle-orm"

import { DomainError } from "@/server/errors"

import type { Transaction } from "./transaction"

/**
 * Locks the row and checks the editor's version. Call first in the save's
 * transaction; the save itself must move updated_at on.
 */
export async function checkVersion(
  tx: Transaction,
  table: "categories" | "collections" | "discounts",
  id: string,
  expectedVersion: string | undefined,
  noun: string,
): Promise<void> {
  const { rows } = await tx.execute<{ updated_at: Date }>(
    sql`select updated_at from ${sql.identifier(table)} where id = ${id} for no key update`,
  )
  const row = rows[0]
  if (!row || !expectedVersion) return
  if (
    new Date(row.updated_at).getTime() !== new Date(expectedVersion).getTime()
  ) {
    throw new DomainError(
      "CONFLICT",
      `Someone else saved this ${noun} after you opened it. Reload to see their changes, then make yours again.`,
    )
  }
}

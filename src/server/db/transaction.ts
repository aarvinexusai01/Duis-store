import "server-only"
import type { PgTransactionConfig } from "drizzle-orm/pg-core"

import { DomainError, isLockConflict } from "@/server/errors"

import { getDb, type Database } from "./client"

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

/**
 * Runs `work` in one database transaction. Business operations that touch
 * money or stock always go through here; jobs that must only exist if the
 * transaction commits are enqueued with `{ db: fromDrizzle(tx, sql) }`.
 *
 * If Postgres aborts it over a lock conflict with a concurrent transaction,
 * nothing was saved and the caller gets a CONFLICT asking to try again,
 * never an internal error. (Not retried here: some transactions call
 * outside services, which must not run twice.)
 */
export async function withTransaction<T>(
  work: (tx: Transaction) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  try {
    return await getDb().transaction(work, config)
  } catch (error) {
    if (isLockConflict(error)) {
      throw new DomainError(
        "CONFLICT",
        "Someone else changed this at the same moment. Please try again.",
      )
    }
    throw error
  }
}

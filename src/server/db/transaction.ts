import "server-only"
import type { PgTransactionConfig } from "drizzle-orm/pg-core"

import { getDb, type Database } from "./client"

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

/**
 * Runs `work` in one database transaction. Business operations that touch
 * money or stock always go through here; jobs that must only exist if the
 * transaction commits are enqueued with `{ db: fromDrizzle(tx, sql) }`.
 */
export function withTransaction<T>(
  work: (tx: Transaction) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  return getDb().transaction(work, config)
}

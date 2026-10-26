import "server-only"
import { Client, errors } from "@elastic/elasticsearch"

import { getServerEnv } from "@/config/env"
import { logger } from "@/server/observability/logger"

/**
 * The Elasticsearch connection (ADR-0033). Search is optional: with no
 * ELASTICSEARCH_URL, or while Elasticsearch is unavailable, the storefront
 * searches Postgres instead (./query.ts limits how much at once).
 *
 * When Elasticsearch can't be reached, searches skip it for BREAKER_MS
 * rather than each failing again. A timeout alone doesn't: under heavy load
 * a slow answer is more likely than an outage, and sending every search to
 * Postgres then would load the database exactly when it's busiest. Only
 * TIMEOUTS_TO_OPEN timeouts in a row count as an outage. Indexing has no
 * hurry and gets a longer timeout.
 */

const BREAKER_MS = 30_000
const TIMEOUTS_TO_OPEN = 3
const INDEXING_TIMEOUT_MS = 30_000

const globalForSearch = globalThis as typeof globalThis & {
  __duisSearch?: Client | null
  __duisSearchDownUntil?: number
  __duisSearchTimeouts?: number
}

export function searchIndexAlias(): string {
  return getServerEnv().ELASTICSEARCH_INDEX
}

/** The client, or null when search isn't configured. */
export function getSearchClient(): Client | null {
  if (globalForSearch.__duisSearch === undefined) {
    const env = getServerEnv()
    globalForSearch.__duisSearch = env.ELASTICSEARCH_URL
      ? new Client({
          node: env.ELASTICSEARCH_URL,
          auth: env.ELASTICSEARCH_PASSWORD
            ? {
                username: env.ELASTICSEARCH_USERNAME,
                password: env.ELASTICSEARCH_PASSWORD,
              }
            : undefined,
          requestTimeout: env.ELASTICSEARCH_TIMEOUT_MS,
          maxRetries: 0,
        })
      : null
  }
  return globalForSearch.__duisSearch
}

/** For the indexer and rebuilds: same connection, longer timeout. */
export function indexingClient(): Client | null {
  return (
    getSearchClient()?.child({ requestTimeout: INDEXING_TIMEOUT_MS }) ?? null
  )
}

/** For storefront reads: null while the breaker is open. */
export function liveSearchClient(): Client | null {
  if ((globalForSearch.__duisSearchDownUntil ?? 0) > Date.now()) return null
  return getSearchClient()
}

/** A storefront search failed (this one falls back to Postgres). */
export function searchFailed(err: unknown): void {
  if (err instanceof errors.TimeoutError) {
    const timeouts = (globalForSearch.__duisSearchTimeouts ?? 0) + 1
    globalForSearch.__duisSearchTimeouts = timeouts
    if (timeouts < TIMEOUTS_TO_OPEN) {
      logger.warn({ err, timeouts }, "elasticsearch search timed out")
      return
    }
  }
  globalForSearch.__duisSearchTimeouts = 0
  const wasUp = (globalForSearch.__duisSearchDownUntil ?? 0) <= Date.now()
  globalForSearch.__duisSearchDownUntil = Date.now() + BREAKER_MS
  if (wasUp) {
    logger.warn({ err }, "elasticsearch unavailable; searching Postgres")
  }
}

export function searchSucceeded(): void {
  globalForSearch.__duisSearchTimeouts = 0
}

export async function closeSearchClient(): Promise<void> {
  const client = globalForSearch.__duisSearch
  globalForSearch.__duisSearch = undefined
  await client?.close()
}

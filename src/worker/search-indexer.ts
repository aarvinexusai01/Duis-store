import {
  closeSearchClient,
  drainSearchQueue,
  ensureSearchIndex,
  getSearchClient,
  SEARCH_CHANNEL,
} from "@/features/catalog"
import { logger } from "@/server/observability/logger"

import { listen } from "./pg-listen"

/**
 * Keeps the search index in step with Postgres (ADR-0033). Triggers queue
 * changed products and notify SEARCH_CHANNEL; this wakes up, briefly waits so
 * a burst of changes goes in one batch, and indexes the queue. It also runs
 * every 30 seconds, which catches anything a lost notification or an
 * Elasticsearch outage left behind. On start it creates the index, or
 * rebuilds it when its mapping changed, before indexing anything.
 */

const DEBOUNCE_MS = 250
const SWEEP_MS = 30_000
const WARN_INTERVAL_MS = 5 * 60_000

export type SearchIndexer = { stop(): Promise<void> }

export function startSearchIndexer(): SearchIndexer | null {
  if (!getSearchClient()) return null // no ELASTICSEARCH_URL: Postgres search

  let indexReady = false
  let running: Promise<void> | null = null
  let again = false
  let lastWarned = 0
  let debounce: NodeJS.Timeout | undefined

  const step = async () => {
    try {
      if (!indexReady) {
        const state = await ensureSearchIndex()
        indexReady = true
        if (state === "rebuilt") logger.info("search index built")
      }
      const handled = await drainSearchQueue()
      if (handled > 0) logger.debug({ handled }, "search index updated")
    } catch (err) {
      // Elasticsearch down: the queue keeps everything until it's back.
      if (Date.now() - lastWarned > WARN_INTERVAL_MS) {
        lastWarned = Date.now()
        logger.warn({ err }, "search indexing failed; will retry")
      }
    }
  }

  const run = () => {
    if (running) {
      again = true
      return
    }
    running = (async () => {
      do {
        again = false
        await step()
      } while (again)
    })().finally(() => {
      running = null
    })
  }

  const sweep = setInterval(run, SWEEP_MS)
  const listener = listen({
    channel: SEARCH_CHANNEL,
    name: "search-indexer",
    onNotify: () => {
      clearTimeout(debounce)
      debounce = setTimeout(run, DEBOUNCE_MS)
    },
    onConnect: run,
  })

  return {
    async stop() {
      clearInterval(sweep)
      clearTimeout(debounce)
      await listener.stop()
      await running
      await closeSearchClient()
    },
  }
}

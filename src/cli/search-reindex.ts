import {
  closeSearchClient,
  drainSearchQueue,
  getSearchClient,
  rebuildSearchIndex,
} from "@/features/catalog"
import { closeDb } from "@/server/db/client"

/**
 * Rebuilds the product search index from Postgres (ADR-0033) and switches to
 * it in one step, so searches keep working throughout:
 *   npm run search:reindex
 *   ops/compose run --rm worker node dist/search-reindex.mjs
 * Rarely needed: the worker keeps the index current and rebuilds it itself
 * when its mapping changes. Use it after restoring Elasticsearch's volume or
 * if search results look wrong.
 */
async function main() {
  if (!getSearchClient()) {
    console.error("ELASTICSEARCH_URL is not set: search runs on Postgres.")
    process.exitCode = 1
    return
  }
  const { indexed } = await rebuildSearchIndex()
  // The rebuild queues everything again to catch changes made meanwhile;
  // index them now rather than waiting for the worker.
  const updated = await drainSearchQueue()
  console.log(`Indexed ${indexed} products (${updated} re-checked).`)
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeSearchClient()
    await closeDb()
  })

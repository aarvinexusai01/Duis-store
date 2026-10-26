import "server-only"
import type { Client } from "@elastic/elasticsearch"
import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"
import { textArray, uuidArray } from "@/server/db/sql"
import { logger } from "@/server/observability/logger"

import { indexingClient, searchIndexAlias } from "./client"
import { loadSearchableProductIds, loadSearchDocuments } from "./documents"
import {
  INDEX_MAPPINGS,
  INDEX_SETTINGS,
  MAPPING_VERSION,
} from "./index-definition"

/**
 * Keeps Elasticsearch in step with Postgres (ADR-0033). Triggers queue every
 * product whose search document changed in `search_index_queue`; the worker
 * drains it here. A full rebuild fills a new index and then points the alias
 * at it in one step, so searches never see a half-built index.
 */

const BATCH = 200
const INDEX_TIMEOUT = "30s"

function requireClient(): Client {
  const client = indexingClient()
  if (!client) throw new Error("ELASTICSEARCH_URL is not set")
  return client
}

const versionPrefix = (alias: string) => `${alias}-v${MAPPING_VERSION}-`

/** The index the alias points at, if any. */
async function currentIndex(client: Client, alias: string) {
  const exists = await client.indices.existsAlias({ name: alias })
  if (!exists) return null
  const found = await client.indices.getAlias({ name: alias })
  return Object.keys(found)[0] ?? null
}

/** Sends these products' documents (or their removal) to the index. */
async function writeDocuments(
  client: Client,
  index: string,
  ids: readonly string[],
): Promise<{ failed: Set<string> }> {
  const { documents, absent } = await loadSearchDocuments(ids)
  if (documents.length === 0 && absent.length === 0)
    return { failed: new Set() }
  const operations = [
    ...documents.flatMap((doc) => [
      { index: { _index: index, _id: doc.id } },
      doc,
    ]),
    ...absent.map((id) => ({ delete: { _index: index, _id: id } })),
  ]
  const result = await client.bulk({ operations, timeout: INDEX_TIMEOUT })
  const failed = new Set<string>()
  if (result.errors) {
    for (const item of result.items) {
      const action = item.index ?? item.delete
      // Deleting a document that was never indexed is fine.
      if (!action?.error || (item.delete && action.status === 404)) continue
      failed.add(action._id ?? "")
      logger.warn(
        { productId: action._id, error: action.error },
        "search document not written",
      )
    }
  }
  return { failed }
}

/**
 * Builds a complete new index, switches the alias to it, then removes older
 * ones. Everything is queued again afterwards, so a change indexed into the
 * old index while this ran isn't lost.
 */
export async function rebuildSearchIndex(): Promise<{ indexed: number }> {
  const client = requireClient()
  const alias = searchIndexAlias()
  const index = `${versionPrefix(alias)}${Date.now()}`
  await client.indices.create({
    index,
    settings: { ...INDEX_SETTINGS, refresh_interval: "-1" },
    mappings: INDEX_MAPPINGS,
  })
  const ids = await loadSearchableProductIds()
  for (let i = 0; i < ids.length; i += BATCH) {
    const { failed } = await writeDocuments(
      client,
      index,
      ids.slice(i, i + BATCH),
    )
    if (failed.size > 0) throw new Error(`${failed.size} documents failed`)
  }
  await client.indices.putSettings({
    index,
    settings: { refresh_interval: "1s" },
  })
  await client.indices.refresh({ index })

  const old = await client.indices
    .get({ index: `${alias}-v*` })
    .then((found) => Object.keys(found).filter((name) => name !== index))
  await client.indices.updateAliases({
    actions: [
      ...old.map((name) => ({ remove: { index: name, alias } })),
      { add: { index, alias, is_write_index: true } },
    ],
  })
  // An alias "remove" for an index that wasn't in it is ignored above; only
  // indexes that exist are deleted.
  if (old.length > 0) await client.indices.delete({ index: old })
  await getDb().execute(sql`
    insert into search_index_queue (product_id) select id from products
    on conflict (product_id) do update set queued_at = clock_timestamp()`)
  logger.info({ index, indexed: ids.length }, "search index rebuilt")
  return { indexed: ids.length }
}

/** Rebuilds when there's no index yet, or it predates MAPPING_VERSION. */
export async function ensureSearchIndex(): Promise<"ready" | "rebuilt"> {
  const client = requireClient()
  const alias = searchIndexAlias()
  const current = await currentIndex(client, alias)
  if (current?.startsWith(versionPrefix(alias))) return "ready"
  await rebuildSearchIndex()
  return "rebuilt"
}

/**
 * Indexes everything queued, oldest first. A row re-queued while its batch
 * was being indexed keeps its place (its queued_at changed). Returns how many
 * products were handled.
 */
export async function drainSearchQueue(): Promise<number> {
  const client = requireClient()
  const alias = searchIndexAlias()
  // Writing to a missing alias would create an index with guessed mappings.
  if (!(await client.indices.existsAlias({ name: alias }))) {
    throw new Error(`search index ${alias} does not exist yet`)
  }
  let handled = 0
  for (;;) {
    const batch = await getDb().execute<{
      product_id: string
      queued_at: string
    }>(sql`
      select product_id, queued_at::text from search_index_queue
      order by queued_at limit ${BATCH}`)
    if (batch.rows.length === 0) return handled
    const ids = batch.rows.map((row) => row.product_id)
    const { failed } = await writeDocuments(client, alias, ids)
    const done = batch.rows.filter((row) => !failed.has(row.product_id))
    if (done.length > 0) {
      await getDb().execute(sql`
        delete from search_index_queue q
        using unnest(${uuidArray(done.map((r) => r.product_id))}, ${textArray(done.map((r) => r.queued_at))}::timestamptz[])
          as handled(product_id, queued_at)
        where q.product_id = handled.product_id and q.queued_at = handled.queued_at`)
    }
    handled += done.length
    // Only failures left: try again on the next wake-up, not in a loop.
    if (done.length === 0) return handled
  }
}

/**
 * The nightly check: products missing from the index, or indexed but no
 * longer for sale, are queued. Returns how many were out of step.
 */
export async function reconcileSearchIndex(): Promise<number> {
  const client = requireClient()
  const expected = new Set(await loadSearchableProductIds())
  const indexed = new Set<string>()
  let after: string[] | undefined
  for (;;) {
    const page = await client.search({
      index: searchIndexAlias(),
      size: 1_000,
      _source: false,
      sort: [{ id: "asc" }],
      search_after: after,
      query: { match_all: {} },
    })
    for (const hit of page.hits.hits) if (hit._id) indexed.add(hit._id)
    const last = page.hits.hits.at(-1)
    if (!last || page.hits.hits.length < 1_000) break
    after = last.sort as string[]
  }
  const drift = [
    ...[...expected].filter((id) => !indexed.has(id)),
    ...[...indexed].filter((id) => !expected.has(id)),
  ]
  if (drift.length > 0) {
    await getDb().execute(sql`select queue_search_index(${uuidArray(drift)})`)
    logger.warn({ count: drift.length }, "search index was out of step; queued")
  }
  return drift.length
}

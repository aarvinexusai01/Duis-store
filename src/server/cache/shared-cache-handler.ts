import { randomUUID } from "node:crypto"

import type { CacheEntry, CacheHandler } from "next/cache"
import { RESP_TYPES } from "redis"

import type { Redis } from "./redis"

/**
 * The "use cache" store shared by every web replica (ADR-0033).
 *
 * - Entries live in Redis, so a product loaded from Postgres once is served
 *   to every visitor on either replica until it's edited or expires. Each
 *   process keeps a small in-memory copy of the entries it has used, so a
 *   popular page doesn't need a Redis read per view.
 * - Entries are namespaced by release: code from one deploy never reads data
 *   shaped by another. Tag invalidations are not namespaced, so an admin edit
 *   reaches every release that's running during a rolling deploy.
 * - Invalidation times live in one Redis hash. `refreshTags()` (once per
 *   request) checks a version key and re-reads the hash only when it changed,
 *   so the in-memory copies never outlive an edit made on the other replica.
 * - Redis is optional and may fail at any moment. Every Redis call is guarded:
 *   failures behave like a miss, and the handler carries on as the in-memory
 *   cache Next.js uses by default. Invalidations that couldn't be written are
 *   kept and written once Redis is back.
 *
 * The tag rules mirror Next's built-in handler
 * (next/dist/server/lib/cache-handlers/default.js).
 */

type Metadata = Omit<CacheEntry, "value">
type Stored = { meta: Metadata; bytes: Uint8Array }
type TagTimes = { stale?: number; expired?: number }

export type SharedCacheOptions = {
  /** null: in-memory only (no REDIS_URL, or during `next build`). */
  redis: Redis | null
  /** The release, so entries from another deploy are never read. */
  namespace: string
  maxMemoryBytes?: number
  /** Serve stale entries until they expire, as Next's dev server does. */
  dev?: boolean
  warn?: (message: string, err: unknown) => void
}

const PREFIX = "duis:next"
const TAGS_KEY = `${PREFIX}:tags`
const TAGS_VERSION_KEY = `${PREFIX}:tags:version`
// Redis keeps an entry no longer than this, even for `expire: Infinity`.
export const MAX_ENTRY_TTL_SECONDS = 7 * 24 * 60 * 60
// An invalidation older than any entry can be is no longer needed.
const TAG_RETENTION_MS = (MAX_ENTRY_TTL_SECONDS + 24 * 60 * 60) * 1000
const WARN_INTERVAL_MS = 30_000

// Raises each tag's stale/expired time, never lowers it: both replicas
// receive every invalidation and may write in either order.
const MERGE_TAGS_SCRIPT = `
for i = 2, #ARGV, 2 do
  local current = tonumber(redis.call('HGET', KEYS[1], ARGV[i]) or '0')
  if tonumber(ARGV[i + 1]) > current then
    redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
  end
end
redis.call('SET', KEYS[2], ARGV[1])
return 1`

const now = () => Date.now()

function encode(meta: Metadata, bytes: Uint8Array): Buffer {
  const header = Buffer.from(JSON.stringify(meta))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(header.length)
  return Buffer.concat([length, header, bytes])
}

function decode(raw: Buffer): Stored {
  const length = raw.readUInt32BE(0)
  const meta = JSON.parse(raw.subarray(4, 4 + length).toString()) as Metadata
  return { meta, bytes: new Uint8Array(raw.subarray(4 + length)) }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/** A size-bounded LRU: a Map keeps insertion order, oldest first. */
class MemoryStore {
  private readonly entries = new Map<string, Stored>()
  private bytes = 0

  constructor(private readonly maxBytes: number) {}

  get(key: string): Stored | undefined {
    const stored = this.entries.get(key)
    if (stored) {
      this.entries.delete(key)
      this.entries.set(key, stored)
    }
    return stored
  }

  set(key: string, stored: Stored): void {
    this.delete(key)
    const size = stored.bytes.byteLength + key.length
    if (size > this.maxBytes) return
    this.entries.set(key, stored)
    this.bytes += size
    for (const [oldest, entry] of this.entries) {
      if (this.bytes <= this.maxBytes) break
      this.entries.delete(oldest)
      this.bytes -= entry.bytes.byteLength + oldest.length
    }
  }

  private delete(key: string): void {
    const existing = this.entries.get(key)
    if (!existing) return
    this.entries.delete(key)
    this.bytes -= existing.bytes.byteLength + key.length
  }
}

export function createSharedCacheHandler(
  options: SharedCacheOptions,
): CacheHandler {
  const { redis, namespace, dev = false } = options
  const memory = new MemoryStore(options.maxMemoryBytes ?? 50 * 1024 * 1024)
  const pendingSets = new Map<string, Promise<void>>()
  const tags = new Map<string, TagTimes>()
  // Invalidations Redis hasn't accepted yet: field (s|tag, e|tag) → time.
  const unsent = new Map<string, number>()
  let seenVersion: string | null | undefined

  let lastWarned = 0
  const warn = (message: string, err: unknown) => {
    if (now() - lastWarned < WARN_INTERVAL_MS) return
    lastWarned = now()
    options.warn?.(message, err)
  }

  /** Runs a Redis call; undefined when Redis is absent, down or slow. */
  async function attempt<T>(
    what: string,
    call: (client: Redis) => Promise<T>,
  ): Promise<T | undefined> {
    if (!redis?.isReady) return undefined
    try {
      return await call(redis)
    } catch (err) {
      warn(`shared cache: ${what} failed`, err)
      return undefined
    }
  }

  const entryKey = (cacheKey: string) => `${PREFIX}:${namespace}:${cacheKey}`

  function merge(tag: string, times: TagTimes): void {
    const current = tags.get(tag) ?? {}
    tags.set(tag, {
      stale: Math.max(current.stale ?? 0, times.stale ?? 0) || undefined,
      expired: Math.max(current.expired ?? 0, times.expired ?? 0) || undefined,
    })
  }

  function isExpired(entryTags: string[], timestamp: number): boolean {
    return entryTags.some((tag) => {
      const expired = tags.get(tag)?.expired
      return expired !== undefined && expired <= now() && expired > timestamp
    })
  }

  function isStale(entryTags: string[], timestamp: number): boolean {
    return entryTags.some((tag) => (tags.get(tag)?.stale ?? 0) > timestamp)
  }

  async function readRemote(cacheKey: string): Promise<Stored | undefined> {
    const raw = await attempt("read", (client) =>
      client
        .withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })
        .get(entryKey(cacheKey)),
    )
    if (!raw) return undefined
    try {
      return decode(raw)
    } catch (err) {
      warn("shared cache: unreadable entry", err)
      return undefined
    }
  }

  async function sendTags(): Promise<void> {
    if (unsent.size === 0) return
    const batch = [...unsent]
    const args = [randomUUID(), ...batch.flatMap(([f, t]) => [f, String(t)])]
    const sent = await attempt("write invalidation", (client) =>
      client.eval(MERGE_TAGS_SCRIPT, {
        keys: [TAGS_KEY, TAGS_VERSION_KEY],
        arguments: args,
      }),
    )
    if (sent === undefined) return
    for (const [field, time] of batch) {
      if (unsent.get(field) === time) unsent.delete(field)
    }
  }

  return {
    async get(cacheKey) {
      const pending = pendingSets.get(cacheKey)
      if (pending) await pending

      let stored = memory.get(cacheKey)
      // Past its revalidate time, another replica may have refreshed it.
      if (
        !stored ||
        now() > stored.meta.timestamp + stored.meta.revalidate * 1000
      ) {
        const remote = await readRemote(cacheKey)
        if (
          remote &&
          (!stored || remote.meta.timestamp > stored.meta.timestamp)
        ) {
          stored = remote
          memory.set(cacheKey, remote)
        }
      }
      if (!stored) return undefined

      // No age check: Next compares `timestamp` with `expire` itself, and an
      // entry past `revalidate` is served while a fresh one is made in the
      // background. (Next's in-memory handler drops it instead, because its
      // replacement would likely be evicted before use; a shared store keeps
      // it, as the cacheHandlers docs recommend.)
      const { meta, bytes } = stored
      if (isExpired(meta.tags, meta.timestamp)) return undefined
      const revalidate = isStale(meta.tags, meta.timestamp)
        ? -1
        : meta.revalidate
      return { ...meta, revalidate, value: streamOf(bytes) }
    },

    async set(cacheKey, pendingEntry) {
      let resolvePending = () => {}
      pendingSets.set(
        cacheKey,
        new Promise<void>((resolve) => {
          resolvePending = resolve
        }),
      )
      try {
        const entry = await pendingEntry
        // An `expire: 0` entry is dynamic and never served back in production.
        if (!dev && entry.expire === 0) return
        const bytes = new Uint8Array(
          await new Response(entry.value).arrayBuffer(),
        )
        const meta: Metadata = {
          tags: entry.tags,
          stale: entry.stale,
          timestamp: entry.timestamp,
          expire: entry.expire,
          revalidate: entry.revalidate,
        }
        memory.set(cacheKey, { meta, bytes })
        const ttl = Number.isFinite(meta.expire)
          ? Math.min(Math.max(1, Math.ceil(meta.expire)), MAX_ENTRY_TTL_SECONDS)
          : MAX_ENTRY_TTL_SECONDS
        await attempt("write", (client) =>
          client.set(entryKey(cacheKey), encode(meta, bytes), {
            expiration: { type: "EX", value: ttl },
          }),
        )
      } catch (err) {
        // A render that failed part-way leaves nothing to store.
        warn("shared cache: entry not stored", err)
      } finally {
        resolvePending()
        pendingSets.delete(cacheKey)
      }
    },

    async refreshTags() {
      await sendTags()
      const version = await attempt("read invalidations", (client) =>
        client.get(TAGS_VERSION_KEY),
      )
      if (version === undefined || version === seenVersion) return
      const all = await attempt("read invalidations", (client) =>
        client.hGetAll(TAGS_KEY),
      )
      if (!all) return
      const old: string[] = []
      for (const [field, value] of Object.entries(all)) {
        const time = Number(value)
        if (time + TAG_RETENTION_MS < now()) {
          old.push(field)
          continue
        }
        const tag = field.slice(2)
        merge(tag, field.startsWith("s|") ? { stale: time } : { expired: time })
      }
      if (old.length > 0) {
        await attempt("prune invalidations", (client) =>
          client.hDel(TAGS_KEY, old),
        )
      }
      seenVersion = version
    },

    async getExpiration(softTags) {
      return Math.max(0, ...softTags.map((tag) => tags.get(tag)?.expired ?? 0))
    },

    async updateTags(updated, durations) {
      const at = now()
      for (const tag of updated) {
        const times: TagTimes = durations
          ? {
              stale: at,
              expired:
                durations.expire === undefined
                  ? undefined
                  : at + durations.expire * 1000,
            }
          : { expired: at }
        merge(tag, times)
        if (times.stale) unsent.set(`s|${tag}`, times.stale)
        if (times.expired) unsent.set(`e|${tag}`, times.expired)
      }
      await sendTags()
    },
  }
}

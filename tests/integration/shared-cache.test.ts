import { randomUUID } from "node:crypto"

import type { CacheEntry, CacheHandler } from "next/cache"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createRedisClient, type Redis } from "@/server/cache/redis"
import {
  createSharedCacheHandler,
  MAX_ENTRY_TTL_SECONDS,
} from "@/server/cache/shared-cache-handler"

/**
 * The "use cache" store shared by both web replicas (ADR-0033), against the
 * tests' own Redis database. Two handlers stand in for web_a and web_b.
 */

const clients: Redis[] = []

async function connected(): Promise<Redis> {
  const client = createRedisClient(process.env.REDIS_URL!, "test")
  clients.push(client)
  for (let i = 0; i < 100 && !client.isReady; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  if (!client.isReady) throw new Error("test Redis is not reachable")
  return client
}

/** A client whose connection the test can cut and restore. */
function switchable(client: Redis) {
  let up = true
  const proxy = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "isReady") return up && target.isReady
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return {
    client: proxy,
    down: () => (up = false),
    up: () => (up = true),
  }
}

afterAll(() => {
  for (const client of clients) client.destroy()
})

function entry(
  text: string,
  overrides: Partial<Omit<CacheEntry, "value">> = {},
): Promise<CacheEntry> {
  return Promise.resolve({
    value: new Response(text).body!,
    tags: [],
    stale: 300,
    // Made a moment ago, so an invalidation "now" is after it.
    timestamp: Date.now() - 1_000,
    expire: 86_400,
    revalidate: 3_600,
    ...overrides,
  })
}

async function read(
  handler: CacheHandler,
  key: string,
): Promise<{ text: string; revalidate: number } | undefined> {
  const found = await handler.get(key, [])
  if (!found) return undefined
  return {
    text: await new Response(found.value).text(),
    revalidate: found.revalidate,
  }
}

describe("the shared cache", () => {
  let redis: Redis
  let release: string
  beforeAll(async () => {
    redis = await connected()
    release = randomUUID()
  })
  const replica = (client: Redis | null = redis, namespace = release) =>
    createSharedCacheHandler({ redis: client, namespace })

  it("serves an entry made on one replica to the other", async () => {
    const webA = replica()
    const webB = replica()
    const key = randomUUID()
    await webA.set(key, entry("product data"))
    expect(await read(webB, key)).toEqual({
      text: "product data",
      revalidate: 3_600,
    })
  })

  it("never serves another release's entries", async () => {
    const key = randomUUID()
    await replica().set(key, entry("old code's data"))
    expect(await read(replica(redis, randomUUID()), key)).toBeUndefined()
  })

  it("stops serving an entry on both replicas once its tag is invalidated", async () => {
    const webA = replica()
    const webB = replica()
    const key = randomUUID()
    const tag = `product:${randomUUID()}`
    await webA.set(key, entry("price ₹999", { tags: [tag] }))
    await webB.refreshTags()
    // Both now hold it in memory as well as in Redis.
    expect((await read(webA, key))?.text).toBe("price ₹999")
    expect((await read(webB, key))?.text).toBe("price ₹999")

    // An admin edit reaches web_a (as revalidateTag(tag, { expire: 0 })).
    await webA.updateTags([tag], { expire: 0 })
    expect(await read(webA, key)).toBeUndefined()

    // web_b learns at the start of its next request.
    await webB.refreshTags()
    expect(await read(webB, key)).toBeUndefined()

    // An invalidation reaches every release that's running (rolling deploy).
    const nextRelease = replica(redis, randomUUID())
    await nextRelease.refreshTags()
    expect(await nextRelease.getExpiration([tag])).toBeGreaterThan(0)
  })

  it("serves an entry made after the edit", async () => {
    const webA = replica()
    const webB = replica()
    const tag = `product:${randomUUID()}`
    await webA.updateTags([tag], { expire: 0 })
    const key = randomUUID()
    await webA.set(
      key,
      entry("new price", { tags: [tag], timestamp: Date.now() + 1 }),
    )
    await webB.refreshTags()
    expect((await read(webB, key))?.text).toBe("new price")
  })

  it("keeps entries in Redis no longer than they may be used", async () => {
    const key = randomUUID()
    await replica().set(key, entry("x", { expire: 3_600 }))
    await replica().set(`${key}-forever`, entry("x", { expire: Infinity }))
    const prefix = `duis:next:${release}:`
    expect(await redis.ttl(`${prefix}${key}`)).toBeGreaterThan(3_590)
    expect(await redis.ttl(`${prefix}${key}`)).toBeLessThanOrEqual(3_600)
    expect(await redis.ttl(`${prefix}${key}-forever`)).toBeLessThanOrEqual(
      MAX_ENTRY_TTL_SECONDS,
    )
  })

  it("doesn't store an entry Next treats as dynamic", async () => {
    const key = randomUUID()
    await replica().set(key, entry("x", { expire: 0 }))
    expect(await read(replica(), key)).toBeUndefined()
  })
})

describe("when Redis is unavailable", () => {
  it("works from memory and never throws or waits", async () => {
    const unreachable = createRedisClient("redis://localhost:1", "test-offline")
    clients.push(unreachable)
    const offline = createSharedCacheHandler({
      redis: unreachable,
      namespace: randomUUID(),
    })
    const key = randomUUID()
    const started = Date.now()
    await offline.refreshTags()
    await offline.set(key, entry("from memory", { tags: ["t"] }))
    expect((await read(offline, key))?.text).toBe("from memory")
    await offline.updateTags(["t"], { expire: 0 })
    expect(await read(offline, key)).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(500)
  })

  it("sends invalidations made during the outage once Redis is back", async () => {
    const release = randomUUID()
    const connection = switchable(await connected())
    const webA = createSharedCacheHandler({
      redis: connection.client,
      namespace: release,
    })
    const webB = createSharedCacheHandler({
      redis: await connected(),
      namespace: release,
    })
    const key = randomUUID()
    const tag = `product:${randomUUID()}`
    await webB.set(key, entry("before the edit", { tags: [tag] }))

    connection.down()
    await webA.updateTags([tag], { expire: 0 })
    connection.up()
    // web_a's next request writes the pending invalidation.
    await webA.refreshTags()

    await webB.refreshTags()
    expect(await read(webB, key)).toBeUndefined()
  })
})

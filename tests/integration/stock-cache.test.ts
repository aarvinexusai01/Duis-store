import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  adjustStock,
  getCachedAvailability,
  STOCK_TTL_SECONDS,
} from "@/features/inventory"
import { closeRedis, getRedis, type Redis } from "@/server/cache/redis"
import { getDb } from "@/server/db/client"
import { startStockListener, type StockListener } from "@/worker/stock-listener"

import { asSystem } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { newCustomers, prepareOrder, variantWithStock } from "./races/support"

/**
 * Product-page stock in Redis (ADR-0033): any stock change, from any code
 * path, clears the cached number through the trigger in migration 0017 and
 * the worker's listener.
 */

closeConnectionsAfterAll()

const key = (variantId: string) => `duis:stock:${variantId}`
let redis: Redis
let listener: StockListener

async function eventually(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("condition not met within 2 seconds")
}

const cached = (variantId: string) => redis.get(key(variantId))
const gone = (variantId: string) => async () =>
  (await cached(variantId)) === null

beforeAll(async () => {
  redis = getRedis()!
  await eventually(async () => redis.isReady)
  listener = startStockListener()!
  // Ready once a change made now is seen (its first act is to clear all).
  const probe = await variantWithStock(1)
  await getCachedAvailability([probe])
  await adjustStock(asSystem(), {
    variantId: probe,
    delta: 1,
    reason: "receive",
  })
  await eventually(gone(probe))
})

afterAll(async () => {
  await listener.stop()
  await closeRedis()
})

describe("product-page stock in Redis", () => {
  it("reads Postgres once, then serves from Redis for a short time", async () => {
    const variantId = await variantWithStock(5)
    expect(await getCachedAvailability([variantId])).toEqual(
      new Map([[variantId, 5]]),
    )
    await eventually(async () => (await cached(variantId)) === "5")
    expect(await redis.ttl(key(variantId))).toBeLessThanOrEqual(
      STOCK_TTL_SECONDS,
    )

    // Proof it comes from Redis: a value only Redis has.
    await redis.set(key(variantId), "4", {
      expiration: { type: "EX", value: 30 },
    })
    expect((await getCachedAvailability([variantId])).get(variantId)).toBe(4)
  })

  it("is cleared when staff change the stock", async () => {
    const variantId = await variantWithStock(5)
    await getCachedAvailability([variantId])
    await eventually(async () => (await cached(variantId)) !== null)

    await adjustStock(asSystem(), { variantId, delta: -2, reason: "damaged" })
    await eventually(gone(variantId))
    expect((await getCachedAvailability([variantId])).get(variantId)).toBe(3)
  })

  it("is cleared when a customer's order holds the last unit", async () => {
    const variantId = await variantWithStock(1)
    await getCachedAvailability([variantId])
    await eventually(async () => (await cached(variantId)) === "1")

    const [customer] = await newCustomers(1)
    const order = await prepareOrder(customer!, variantId)
    await order.place()
    await eventually(gone(variantId))
    expect((await getCachedAvailability([variantId])).get(variantId)).toBe(0)
  })

  it("isn't touched by a change that rolls back", async () => {
    const variantId = await variantWithStock(5)
    await getCachedAvailability([variantId])
    await eventually(async () => (await cached(variantId)) === "5")

    await getDb()
      .transaction(async (tx) => {
        await tx.execute(
          sql`update inventory_levels set on_hand = 0 where variant_id = ${variantId}`,
        )
        throw new Error("rolled back")
      })
      .catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await cached(variantId)).toBe("5")
  })

  it("is cleared for every product when a stock location is switched off or on", async () => {
    const first = await variantWithStock(2)
    const second = await variantWithStock(3)
    await getCachedAvailability([first, second])
    await eventually(async () => (await cached(second)) !== null)

    // A location with no stock: switching it changes nobody's numbers, but
    // the listener can't know that, so it clears everything.
    const { rows } = await getDb().execute<{ id: string }>(sql`
      insert into stock_locations (code, name, address_line1, city, state_code, postal_code, country_code)
      values ('cache-test-' || substr(md5(random()::text), 1, 8), 'Cache test', '1 Test Road', 'Mumbai', 'IN-MH', '400001', 'IN')
      returning id`)
    await getDb().execute(
      sql`update stock_locations set is_active = false where id = ${rows[0]!.id}`,
    )
    await eventually(gone(first))
    await eventually(gone(second))
  })

  it("falls back to Postgres while Redis is unavailable", async () => {
    const variantId = await variantWithStock(7)
    const global = globalThis as { __duisRedis?: Redis | null }
    const saved = global.__duisRedis
    global.__duisRedis = null
    try {
      expect((await getCachedAvailability([variantId])).get(variantId)).toBe(7)
    } finally {
      global.__duisRedis = saved
    }
  })
})

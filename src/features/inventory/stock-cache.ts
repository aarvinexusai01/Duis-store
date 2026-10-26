import "server-only"

import { anonymousActor } from "@/server/auth/actor"
import { readyRedis, type Redis } from "@/server/cache/redis"

import { getAvailability } from "./service"

/**
 * Product-page stock, kept in Redis so a busy product page doesn't read
 * Postgres on every view (ADR-0033).
 *
 * Every stock change notifies `duis_stock` from a trigger once its
 * transaction commits (migration 0017), and the worker's listener deletes the
 * variant's entry, so the next view reads Postgres again. An entry still
 * expires after STOCK_TTL_SECONDS: a view that read Postgres just before a
 * sale committed can write the old number back after the sale cleared it.
 * Checkout never uses this: it reserves against the stock rows under a lock.
 */

export const STOCK_TTL_SECONDS = 30
export const STOCK_CHANNEL = "duis_stock"
const PREFIX = "duis:stock:"
export const STOCK_KEY_PATTERN = `${PREFIX}*`

export const stockKey = (variantId: string) => `${PREFIX}${variantId}`

/** Available units per variant: Redis first, then Postgres for the rest. */
export async function getCachedAvailability(
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(variantIds)]
  const redis = readyRedis()
  const result = new Map<string, number>()
  let missing = ids

  if (redis && ids.length > 0) {
    try {
      const values = await redis.mGet(ids.map(stockKey))
      missing = ids.filter((id, index) => {
        const value = values[index]
        if (value == null) return true
        result.set(id, Number(value))
        return false
      })
    } catch {
      missing = ids
    }
  }
  if (missing.length === 0) return result

  const fresh = await getAvailability(anonymousActor(), {
    variantIds: missing,
  })
  for (const [id, available] of fresh) result.set(id, available)
  if (redis) void remember(redis, fresh)
  return result
}

async function remember(redis: Redis, stock: Map<string, number>) {
  try {
    const batch = redis.multi()
    for (const [id, available] of stock) {
      batch.set(stockKey(id), String(available), {
        expiration: { type: "EX", value: STOCK_TTL_SECONDS },
      })
    }
    await batch.exec()
  } catch {
    // A cache write that fails only means the next view reads Postgres.
  }
}

/** Drops cached stock: one variant, or every variant ("*"). */
export async function forgetStock(
  redis: Redis,
  variantId: string,
): Promise<void> {
  if (variantId !== "*") {
    await redis.del(stockKey(variantId))
    return
  }
  for await (const keys of redis.scanIterator({
    MATCH: STOCK_KEY_PATTERN,
    COUNT: 500,
  })) {
    if (keys.length > 0) await redis.del(keys)
  }
}

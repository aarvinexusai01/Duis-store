import { forgetStock, STOCK_CHANNEL } from "@/features/inventory"
import { getRedis, type Redis } from "@/server/cache/redis"
import { logger } from "@/server/observability/logger"

import { listen } from "./pg-listen"

/**
 * Deletes a variant's cached product-page stock as soon as Postgres reports a
 * change (migration 0017, ADR-0033). Notifications sent while it isn't
 * listening, or while Redis is unreachable, are lost, so every (re)connect to
 * either one starts by clearing all cached stock; the entries' 30-second
 * expiry covers the time in between.
 */

export type StockListener = { stop(): Promise<void> }

export function startStockListener(): StockListener | null {
  const redis = getRedis()
  if (!redis) return null // no REDIS_URL: product pages read stock live

  const pending = new Set<string>()
  let flushing: Promise<void> | null = null
  const flush = async () => {
    while (pending.size > 0) {
      const ids = [...pending]
      pending.clear()
      await clear(redis, ids)
    }
    flushing = null
  }

  const clearAll = () => void clear(redis, ["*"])
  redis.on("ready", clearAll)
  const listener = listen({
    channel: STOCK_CHANNEL,
    name: "stock-listener",
    onNotify: (variantId) => {
      if (!variantId) return
      pending.add(variantId)
      flushing ??= flush()
    },
    onConnect: () => clear(redis, ["*"]),
  })

  return {
    async stop() {
      redis.off("ready", clearAll)
      await listener.stop()
      await flushing
    },
  }
}

async function clear(redis: Redis, ids: string[]): Promise<void> {
  if (!redis.isReady) return // cleared on reconnect instead
  try {
    if (ids.includes("*")) {
      await forgetStock(redis, "*")
      return
    }
    await Promise.all(ids.map((id) => forgetStock(redis, id)))
  } catch (err) {
    logger.warn({ err }, "could not clear cached stock")
  }
}

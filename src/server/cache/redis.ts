import "server-only"
import { createClient } from "redis"

import { logger } from "@/server/observability/logger"

/**
 * Redis connections (ADR-0033). Redis is only ever a cache: every caller
 * treats an error as a miss and falls back to Postgres. So commands fail fast
 * instead of queueing while Redis is unreachable, the client reconnects in the
 * background, and a slow Redis can delay a request by at most the timeout.
 */

export type Redis = ReturnType<typeof createRedisClient>

const COMMAND_TIMEOUT_MS = 250
const ERROR_LOG_INTERVAL_MS = 30_000

/** Reads REDIS_URL directly: the Next.js cache handler loads before (and
 * without) the app's validated configuration, during `next build` too. */
export function redisUrl(): string | undefined {
  return process.env.REDIS_URL?.trim() || undefined
}

export function createRedisClient(url: string, purpose: string) {
  const client = createClient({
    url,
    name: `duis-${process.env.SERVICE_NAME ?? "web"}-${purpose}`,
    disableOfflineQueue: true,
    commandOptions: { timeout: COMMAND_TIMEOUT_MS },
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000),
    },
  })
  // Reconnect attempts emit an error each time; log the outage, not each try.
  let lastLogged = 0
  client.on("error", (err: unknown) => {
    const now = Date.now()
    if (now - lastLogged < ERROR_LOG_INTERVAL_MS) return
    lastLogged = now
    logger.warn({ err, purpose }, "redis unavailable; falling back to Postgres")
  })
  client.on("ready", () => {
    if (lastLogged) logger.info({ purpose }, "redis connection restored")
    lastLogged = 0
  })
  // Retries forever in the background; callers check isReady.
  client.connect().catch(() => {})
  return client
}

// One client per process for app code (hot reloads in development keep it).
const globalForRedis = globalThis as typeof globalThis & {
  __duisRedis?: Redis | null
}

/** The process's shared client, or null when Redis isn't configured. */
export function getRedis(): Redis | null {
  if (globalForRedis.__duisRedis === undefined) {
    const url = redisUrl()
    globalForRedis.__duisRedis = url ? createRedisClient(url, "app") : null
  }
  return globalForRedis.__duisRedis
}

/** The shared client if it's connected right now, otherwise null. */
export function readyRedis(): Redis | null {
  const client = getRedis()
  return client?.isReady ? client : null
}

export async function closeRedis(): Promise<void> {
  const client = globalForRedis.__duisRedis
  globalForRedis.__duisRedis = undefined
  if (client?.isOpen) await client.close()
}

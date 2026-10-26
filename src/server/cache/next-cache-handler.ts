import { readFileSync } from "node:fs"

import { logger } from "@/server/observability/logger"

import { createRedisClient, redisUrl } from "./redis"
import { createSharedCacheHandler } from "./shared-cache-handler"

/**
 * Entry point Next.js loads for "use cache" (next.config.ts → cacheHandlers).
 * Bundled on its own as dist/cache-handler.mjs by scripts/build-server-bundles.mjs,
 * because Next imports it at runtime with plain Node.
 */

/** The release whose entries this process may read (ADR-0033). */
function release(): string {
  const sha = process.env.APP_SHA
  if (sha && sha !== "dev") return sha
  try {
    // `npm start` and the E2E servers: the standalone build's own ID.
    return readFileSync(".next/BUILD_ID", "utf8").trim()
  } catch {
    return "dev"
  }
}

// `next build` never talks to Redis, as it never talks to Postgres (ADR-016).
const building = process.env.NEXT_PHASE === "phase-production-build"
const url = building ? undefined : redisUrl()

export default createSharedCacheHandler({
  redis: url ? createRedisClient(url, "next-cache") : null,
  namespace: release(),
  dev: process.env.NODE_ENV === "development",
  warn: (message, err) => logger.warn({ err }, message),
})

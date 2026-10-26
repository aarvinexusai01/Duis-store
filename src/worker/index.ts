import { writeFile } from "node:fs/promises"

import { getServerEnv } from "@/config/env"
import { closeRedis } from "@/server/cache/redis"
import { closeDb } from "@/server/db/client"
import { createBoss } from "@/server/jobs/boss"
import { stopSender } from "@/server/jobs/enqueue"
import { ensureQueues } from "@/server/jobs/queues"
import { logger } from "@/server/observability/logger"

import { registerHandlers } from "./handlers"
import { flushWorkerSentry, initWorkerSentry } from "./sentry"
import { startSearchIndexer } from "./search-indexer"
import { startStockListener } from "./stock-listener"

/**
 * Background worker: one process per container, same image as the web app.
 * Handlers live in ./handlers and call feature services.
 */

const HEARTBEAT_FILE =
  process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/worker-heartbeat"
const HEARTBEAT_INTERVAL_MS = 30_000
const SHUTDOWN_TIMEOUT_MS = 30_000

async function touchHeartbeat(): Promise<void> {
  // The container health check fails if this file is older than ~90 seconds,
  // which catches a blocked event loop as well as a crashed process.
  await writeFile(HEARTBEAT_FILE, new Date().toISOString())
}

async function main(): Promise<void> {
  initWorkerSentry(getServerEnv()) // also fails fast on invalid configuration

  const boss = createBoss("worker")
  await boss.start()
  await ensureQueues(boss, (message) => logger.warn(message))
  await registerHandlers(boss)
  const stockListener = startStockListener()
  const searchIndexer = startSearchIndexer()

  await touchHeartbeat()
  const heartbeat = setInterval(() => {
    touchHeartbeat().catch((err: unknown) => {
      logger.error({ err }, "could not write worker heartbeat")
    })
  }, HEARTBEAT_INTERVAL_MS)

  logger.info("worker started")

  let stopping = false
  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) return
    stopping = true
    logger.info({ signal }, "worker stopping")
    clearInterval(heartbeat)
    try {
      // Let in-flight jobs finish; anything unfinished is retried later.
      await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS })
      await stockListener?.stop()
      await searchIndexer?.stop()
      await closeRedis()
      await stopSender()
      await closeDb()
      await flushWorkerSentry()
      logger.info("worker stopped")
      process.exit(0)
    } catch (err) {
      logger.error({ err }, "worker shutdown failed")
      process.exit(1)
    }
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"))
  process.once("SIGINT", () => void shutdown("SIGINT"))
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "worker failed to start")
  process.exit(1)
})

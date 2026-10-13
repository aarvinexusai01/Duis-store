import { writeFile } from "node:fs/promises"

import { getServerEnv } from "@/config/env"
import { closeDb } from "@/server/db/client"
import { createBoss } from "@/server/jobs/boss"
import { QUEUES } from "@/server/jobs/queues"
import { logger } from "@/server/observability/logger"

/**
 * Background worker: one process per container, same image as the web app.
 * Handlers stay thin and call feature services; no business logic lives here.
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
  getServerEnv() // fail fast on invalid configuration

  const boss = createBoss("worker")
  await boss.start()

  await boss.createQueue(QUEUES.systemHeartbeat)
  await boss.schedule(QUEUES.systemHeartbeat, "* * * * *", null, {
    tz: "Asia/Kolkata",
  })
  await boss.work(QUEUES.systemHeartbeat, async ([job]) => {
    logger.debug({ jobId: job?.id }, "heartbeat job processed")
  })

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
      await closeDb()
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

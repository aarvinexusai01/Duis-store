import "server-only"
import { sql } from "drizzle-orm"
import { fromDrizzle, type PgBoss } from "pg-boss"

import type { Transaction } from "@/server/db/transaction"

import { logger } from "@/server/observability/logger"

import { createBoss } from "./boss"
import { ensureQueues, type JobPayloads, type QueueName } from "./queues"

const globalForJobs = globalThis as typeof globalThis & {
  __duisSender?: Promise<PgBoss>
}

/**
 * One send-only pg-boss instance per process (web, worker, scripts). It
 * creates any missing queue first (idempotent): after a deploy the web
 * replicas may send before the new worker has started, and pg-boss refuses
 * to send to a queue that doesn't exist.
 */
function getSender(): Promise<PgBoss> {
  globalForJobs.__duisSender ??= (async () => {
    const boss = createBoss("web")
    await boss.start()
    await ensureQueues(boss, (message) => logger.warn(message))
    return boss
  })().catch((err: unknown) => {
    globalForJobs.__duisSender = undefined
    throw err
  })
  return globalForJobs.__duisSender
}

type EnqueueOptions = {
  /** Enqueue inside this transaction: the job exists only if it commits. */
  tx?: Transaction
  singletonKey?: string
  startAfter?: Date | number
}

export async function enqueue<Q extends QueueName>(
  queue: Q,
  data: JobPayloads[Q],
  options: EnqueueOptions = {},
): Promise<string | null> {
  const boss = await getSender()
  return boss.send(queue, data as object | null, {
    ...(options.tx ? { db: fromDrizzle(options.tx, sql) } : {}),
    ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
    ...(options.startAfter !== undefined
      ? { startAfter: options.startAfter }
      : {}),
  })
}

export async function stopSender(): Promise<void> {
  const pending = globalForJobs.__duisSender
  globalForJobs.__duisSender = undefined
  if (pending) await (await pending).stop({ graceful: false })
}

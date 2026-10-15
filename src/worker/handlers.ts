import type { Job, PgBoss } from "pg-boss"

import { refreshAutomaticCollections } from "@/features/collections"
import { expireReservations } from "@/features/inventory"
import { fanOutRevalidation } from "@/server/cache/revalidate"
import { QUEUES, type JobPayloads, type QueueName } from "@/server/jobs/queues"
import { deliverEmail, markEmailFailed } from "@/server/notifications/delivery"
import { logger } from "@/server/observability/logger"

/**
 * Queue → handler wiring. Handlers stay thin and call services; pg-boss's
 * default batch size of one means a failed job is retried alone, so a retry
 * can never resend an email that already went out.
 */
type Handler<Q extends QueueName> = (job: Job<JobPayloads[Q]>) => Promise<void>

const handlers: { [Q in QueueName]: Handler<Q> } = {
  "system.heartbeat": async (job) => {
    logger.debug({ jobId: job.id }, "heartbeat job processed")
  },
  "system.dead-letter": async (job) => {
    const data = job.data as { notificationId?: string } | null
    if (data?.notificationId) await markEmailFailed(data.notificationId)
    logger.error(
      { jobId: job.id, data: job.data },
      "job moved to the dead-letter queue",
    )
  },
  "notify.email": async (job) => {
    await deliverEmail(job.data)
  },
  "cache.revalidate": async (job) => {
    await fanOutRevalidation(job.data.tags)
  },
  "catalog.refresh-auto-collections": async (job) => {
    const members = await refreshAutomaticCollections(job.data.collectionId)
    logger.info({ members }, "automatic collections refreshed")
  },
  "inventory.expire-reservations": async () => {
    const expired = await expireReservations()
    if (expired > 0)
      logger.info({ expired }, "expired stock reservations released")
  },
}

/** Recurring jobs, in IST. */
const SCHEDULES: { queue: QueueName; cron: string }[] = [
  { queue: QUEUES.systemHeartbeat, cron: "* * * * *" },
  { queue: QUEUES.expireReservations, cron: "* * * * *" },
  { queue: QUEUES.refreshAutoCollections, cron: "30 2 * * *" },
]

export async function registerHandlers(boss: PgBoss): Promise<void> {
  for (const queue of Object.keys(handlers) as QueueName[]) {
    const handler = handlers[queue] as Handler<QueueName>
    await boss.work<JobPayloads[QueueName]>(queue, async ([job]) => {
      if (job) await handler(job)
    })
  }
  for (const { queue, cron } of SCHEDULES) {
    await boss.schedule(queue, cron, null, { tz: "Asia/Kolkata" })
  }
}

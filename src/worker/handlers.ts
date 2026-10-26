import type { Job, PgBoss } from "pg-boss"

import { sendMetaPurchase } from "@/features/analytics"
import { getSearchClient, reconcileSearchIndex } from "@/features/catalog"
import { publishScheduled } from "@/features/cms"
import { refreshAutomaticCollections } from "@/features/collections"
import { expireReservations, sendLowStockDigest } from "@/features/inventory"
// Loading these registers the parcel and payment listeners.
import "@/features/exchanges"
import {
  expirePendingOrders,
  processWebhookEvent,
  reconcilePendingPayments,
} from "@/features/orders"
import { sendBackInStock } from "@/features/alerts"
import { sendCartReminders } from "@/features/marketing"
import { processRefund } from "@/features/payments"
import { sendReviewRequests } from "@/features/reviews"
import { runOpsChecks } from "@/features/system"
import {
  processTrackingWebhook,
  runShipmentJob,
  syncActiveShipments,
} from "@/features/shipping"
import { expireWalletCredits } from "@/features/wallet"
import { fanOutRevalidation } from "@/server/cache/revalidate"
import { QUEUES, type JobPayloads, type QueueName } from "@/server/jobs/queues"
import { deliverEmail, markEmailFailed } from "@/server/notifications/delivery"
import { deliverWhatsApp } from "@/server/notifications/whatsapp"
import { logger } from "@/server/observability/logger"

import { reportJobError } from "./sentry"

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
  "notify.whatsapp": async (job) => {
    await deliverWhatsApp(job.data)
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
  "orders.expire-pending": async () => {
    const result = await expirePendingOrders()
    if (result.expired + result.confirmed > 0)
      logger.info(result, "unpaid orders processed")
  },
  "payments.process-webhook": async (job) => {
    await processWebhookEvent(job.data.webhookEventId)
  },
  "payments.reconcile": async () => {
    const settled = await reconcilePendingPayments()
    if (settled > 0) logger.info({ settled }, "payments reconciled")
  },
  "payments.refund": async (job) => {
    await processRefund(job.data.refundId)
  },
  "wallet.expire-credits": async () => {
    const expired = await expireWalletCredits()
    if (expired > 0)
      logger.info({ expired }, "promotional wallet credit expired")
  },
  "shipping.create-shipment": async (job) => {
    await runShipmentJob(job.data.shipmentId)
  },
  "shipping.process-tracking": async (job) => {
    await processTrackingWebhook(job.data.webhookEventId)
  },
  "alerts.back-in-stock": async (job) => {
    const sent = await sendBackInStock(job.data.variantId)
    if (sent > 0) logger.info({ sent }, "back-in-stock alerts queued")
  },
  "marketing.cart-reminders": async () => {
    const sent = await sendCartReminders()
    if (sent > 0) logger.info({ sent }, "cart reminders queued")
  },
  "cms.publish-scheduled": async () => {
    const published = await publishScheduled()
    if (published > 0) logger.info({ published }, "scheduled content published")
  },
  "analytics.meta-purchase": async (job) => {
    await sendMetaPurchase(job.data.orderId)
  },
  "reviews.request": async () => {
    const sent = await sendReviewRequests()
    if (sent > 0) logger.info({ sent }, "review requests queued")
  },
  "inventory.low-stock-digest": async () => {
    const sent = await sendLowStockDigest()
    if (sent > 0) logger.info({ sent }, "low-stock digest queued")
  },
  "search.reconcile": async () => {
    if (!getSearchClient()) return // search runs on Postgres
    const drift = await reconcileSearchIndex()
    if (drift > 0) logger.info({ drift }, "search index repaired")
  },
  "system.ops-check": async () => {
    const sent = await runOpsChecks()
    if (sent > 0) logger.warn({ sent }, "ops alert emails queued")
  },
  "shipping.sync-tracking": async () => {
    const applied = await syncActiveShipments()
    if (applied > 0) logger.info({ applied }, "parcel tracking synced")
  },
}

/** Recurring jobs, in IST. */
const SCHEDULES: { queue: QueueName; cron: string }[] = [
  { queue: QUEUES.systemHeartbeat, cron: "* * * * *" },
  { queue: QUEUES.expireReservations, cron: "* * * * *" },
  { queue: QUEUES.expirePendingOrders, cron: "* * * * *" },
  { queue: QUEUES.reconcilePayments, cron: "*/5 * * * *" },
  { queue: QUEUES.expireWalletCredits, cron: "15 3 * * *" },
  { queue: QUEUES.refreshAutoCollections, cron: "30 2 * * *" },
  { queue: QUEUES.syncTracking, cron: "*/30 * * * *" },
  { queue: QUEUES.lowStockDigest, cron: "0 9 * * *" },
  { queue: QUEUES.reviewRequests, cron: "0 11 * * *" },
  { queue: QUEUES.cartReminders, cron: "*/15 * * * *" },
  { queue: QUEUES.publishScheduledContent, cron: "* * * * *" },
  { queue: QUEUES.opsCheck, cron: "*/15 * * * *" },
  { queue: QUEUES.reconcileSearch, cron: "45 3 * * *" },
]

/**
 * WORKER_QUEUES (comma-separated) limits a worker to some queues, e.g. the
 * E2E suite's cache-only worker. Unset: every queue (production).
 */
function selectedQueues(): Set<QueueName> | null {
  const list = process.env.WORKER_QUEUES?.split(",")
    .map((name) => name.trim())
    .filter(Boolean)
  return list?.length ? new Set(list as QueueName[]) : null
}

export async function registerHandlers(boss: PgBoss): Promise<void> {
  const only = selectedQueues()
  for (const queue of Object.keys(handlers) as QueueName[]) {
    if (only && !only.has(queue)) continue
    const handler = handlers[queue] as Handler<QueueName>
    await boss.work<JobPayloads[QueueName]>(queue, async ([job]) => {
      if (!job) return
      try {
        await handler(job)
      } catch (err) {
        reportJobError(err, { queue, id: job.id })
        throw err
      }
    })
  }
  for (const { queue, cron } of SCHEDULES) {
    if (only && !only.has(queue)) continue
    await boss.schedule(queue, cron, null, { tz: "Asia/Kolkata" })
  }
}

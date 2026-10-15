import type { PgBoss } from "pg-boss"

import type { EmailTemplateName } from "@/server/notifications/templates"

/**
 * Every queue, its payload and its policy (doc/02 §4.5). Names use
 * `domain.action`; Phase 3+ adds payments, shipping and marketing queues.
 */
export const QUEUES = {
  systemHeartbeat: "system.heartbeat",
  deadLetter: "system.dead-letter",
  notifyEmail: "notify.email",
  cacheRevalidate: "cache.revalidate",
  refreshAutoCollections: "catalog.refresh-auto-collections",
  expireReservations: "inventory.expire-reservations",
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export type JobPayloads = {
  "system.heartbeat": null
  "system.dead-letter": unknown
  "notify.email": {
    notificationId: string
    template: EmailTemplateName
    to: string
    props: Record<string, unknown>
  }
  "cache.revalidate": { tags: string[] }
  "catalog.refresh-auto-collections": { collectionId?: string }
  "inventory.expire-reservations": null
}

type QueuePolicy = Parameters<PgBoss["createQueue"]>[1]

const deadLetter = QUEUES.deadLetter

export const QUEUE_POLICIES: Record<QueueName, QueuePolicy> = {
  "system.dead-letter": { retryLimit: 0, deleteAfterSeconds: 30 * 24 * 3600 },
  "system.heartbeat": { retryLimit: 0, expireInSeconds: 60 },
  // Email links carry tokens: keep finished jobs only briefly.
  "notify.email": {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
    deleteAfterSeconds: 3600,
    deadLetter,
  },
  "cache.revalidate": {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter,
  },
  // Every catalogue change asks for a refresh; "stately" keeps at most one
  // queued and one running, so a burst of edits costs one rebuild.
  "catalog.refresh-auto-collections": {
    policy: "stately",
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter,
  },
  "inventory.expire-reservations": {
    retryLimit: 1,
    retryDelay: 10,
    expireInSeconds: 120,
    deadLetter,
  },
}

/**
 * Creates missing queues and applies the current settings (idempotent).
 * A queue's `policy` is fixed at creation: if it differs, this reports it
 * instead of deleting the queue (and its jobs) automatically.
 */
export async function ensureQueues(
  boss: PgBoss,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  // The dead-letter queue must exist before queues that point at it.
  const names = [
    QUEUES.deadLetter,
    ...Object.values(QUEUES).filter((name) => name !== QUEUES.deadLetter),
  ]
  for (const name of names) {
    const { policy = "standard", ...settings } = QUEUE_POLICIES[name] ?? {}
    await boss.createQueue(name, { policy, ...settings })
    await boss.updateQueue(name, settings)

    const existing = await boss.getQueue(name)
    if (existing && existing.policy !== policy) {
      warn(
        `Queue ${name} has policy "${existing.policy}" but "${policy}" is configured. ` +
          "Drain the queue, then delete it so the worker recreates it.",
      )
    }
  }
}

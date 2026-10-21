import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { maskEmail } from "@/lib/mask"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import {
  discardJob,
  enqueue,
  getQueueCounts,
  retryJob,
} from "@/server/jobs/enqueue"
import { QUEUES, type QueueName } from "@/server/jobs/queues"
import { defineOperation } from "@/server/operation"

import { loadOpsChecks } from "./ops-checks"

/**
 * The audit log viewer and the system page (doc/06 Phase 4 §11): job
 * queues, failed jobs (retry or discard), webhook events and the worker's
 * heartbeat. Job data is summarised, never shown whole: it can hold
 * addresses and email links.
 */

export const AUDIT_PAGE_SIZE = 50

export type AuditRow = {
  id: string
  at: Date
  actor: string
  actorType: string
  roles: string[]
  action: string
  entityType: string
  entityId: string | null
  changes: unknown
  ip: string | null
}

export const listAuditLogs = defineOperation({
  name: "audit.list",
  access: { audit: ["read"] },
  input: z.object({
    actor: z.string().trim().max(100).optional(),
    action: z.string().trim().max(100).optional(),
    entityType: z.string().trim().max(60).optional(),
    entityId: z.string().trim().max(100).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, input) {
    const like = (v: string) => `%${v.replace(/[%_\\]/g, "\\$&")}%`
    const rows = await getDb().execute<{
      id: string
      created_at: Date
      actor_name: string | null
      actor_email: string | null
      actor_type: string
      actor_roles: string[]
      action: string
      entity_type: string
      entity_id: string | null
      changes: unknown
      ip: string | null
      total: number
    }>(sql`
      select a.id, a.created_at, u.name as actor_name, u.email as actor_email, a.actor_type, a.actor_roles,
             a.action, a.entity_type, a.entity_id, a.changes, a.ip, count(*) over ()::int as total
      from audit_logs a left join users u on u.id = a.actor_user_id
      where true
        ${input.actor ? sql`and (u.name ilike ${like(input.actor)} or u.email ilike ${like(input.actor)})` : sql``}
        ${input.action ? sql`and a.action ilike ${like(input.action)}` : sql``}
        ${input.entityType ? sql`and a.entity_type = ${input.entityType}` : sql``}
        ${input.entityId ? sql`and a.entity_id = ${input.entityId}` : sql``}
        ${input.from ? sql`and a.created_at >= (${input.from}::date)::timestamp at time zone 'Asia/Kolkata'` : sql``}
        ${input.to ? sql`and a.created_at < (${input.to}::date + 1)::timestamp at time zone 'Asia/Kolkata'` : sql``}
      order by a.created_at desc
      limit ${AUDIT_PAGE_SIZE} offset ${(input.page - 1) * AUDIT_PAGE_SIZE}`)
    const types = await getDb().execute<{ entity_type: string }>(
      sql`select distinct entity_type from audit_logs order by 1`,
    )
    return {
      total: rows.rows[0]?.total ?? 0,
      entityTypes: types.rows.map((r) => r.entity_type),
      rows: rows.rows.map((r): AuditRow => ({
        id: r.id,
        at: new Date(r.created_at),
        actor:
          r.actor_name && r.actor_email
            ? `${r.actor_name} (${r.actor_email})`
            : r.actor_type === "system"
              ? "System"
              : "Unknown",
        actorType: r.actor_type,
        roles: r.actor_roles,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        changes: r.changes,
        ip: r.ip,
      })),
    }
  },
})

const KNOWN_QUEUES = new Set<string>(Object.values(QUEUES))
// Fields worth showing to identify a job; everything else stays hidden.
const SAFE_KEYS = [
  "template",
  "refundId",
  "shipmentId",
  "webhookEventId",
  "notificationId",
  "collectionId",
] as const

function summarise(data: unknown): string {
  if (!data || typeof data !== "object") return ""
  const record = data as Record<string, unknown>
  const parts = SAFE_KEYS.filter((k) => typeof record[k] === "string").map(
    (k) => `${k}: ${String(record[k])}`,
  )
  if (typeof record.to === "string") parts.push(`to: ${maskEmail(record.to)}`)
  return parts.join(" · ")
}

export type FailedJob = {
  id: string
  queue: string
  summary: string
  error: string
  retries: number
  failedAt: Date | null
}

export const getSystemStatus = defineOperation({
  name: "system.status",
  access: { system: ["read"] },
  input: z.object({}),
  async handler() {
    const db = getDb()
    const [queues, failed, heartbeat, webhooks, checks] = await Promise.all([
      getQueueCounts(),
      db.execute<{
        id: string
        name: string
        data: unknown
        output: { message?: string } | null
        retry_count: number
        completed_on: Date | null
      }>(sql`
        select id, name, data, output, retry_count, completed_on from pgboss.job
        where state = 'failed' and name <> ${QUEUES.deadLetter} and name not like '\\_\\_%'
        order by completed_on desc nulls last limit 100`),
      db.execute<{ at: Date | null }>(sql`
        select max(completed_on) as at from pgboss.job where name = ${QUEUES.systemHeartbeat} and state = 'completed'`),
      db.execute<{
        id: string
        provider: string
        event_type: string
        status: string
        attempts: number
        last_error: string | null
        received_at: Date
      }>(sql`
        select id, provider, event_type, status, attempts, last_error, received_at
        from webhook_events order by received_at desc limit 50`),
      loadOpsChecks(),
    ])
    const at = heartbeat.rows[0]?.at ? new Date(heartbeat.rows[0].at) : null
    return {
      queues,
      checks,
      heartbeatAt: at,
      // The heartbeat job runs every minute.
      workerRunning: at !== null && Date.now() - at.getTime() < 3 * 60_000,
      failed: failed.rows.map((j): FailedJob => ({
        id: j.id,
        queue: j.name,
        summary: summarise(j.data),
        error: (j.output?.message ?? "").slice(0, 300),
        retries: j.retry_count,
        failedAt: j.completed_on ? new Date(j.completed_on) : null,
      })),
      webhooks: webhooks.rows.map((w) => ({
        id: w.id,
        provider: w.provider,
        type: w.event_type,
        status: w.status,
        attempts: w.attempts,
        error: w.last_error,
        receivedAt: new Date(w.received_at),
      })),
    }
  },
})

const jobInput = z.object({
  queue: z.string().refine((q) => KNOWN_QUEUES.has(q), "Unknown queue."),
  id: z.uuid(),
})

export const retryFailedJob = defineOperation({
  name: "system.retryJob",
  access: { system: ["operate"] },
  input: jobInput,
  async handler({ actor }, { queue, id }) {
    await retryJob(queue as QueueName, id)
    await withTransaction((tx) =>
      writeAudit(tx, actor, {
        action: "system.retry_job",
        entityType: "job",
        entityId: id,
        changes: { queue },
      }),
    )
    return {}
  },
})

export const discardFailedJob = defineOperation({
  name: "system.discardJob",
  access: { system: ["operate"] },
  input: jobInput,
  async handler({ actor }, { queue, id }) {
    await discardJob(queue as QueueName, id)
    await withTransaction((tx) =>
      writeAudit(tx, actor, {
        action: "system.discard_job",
        entityType: "job",
        entityId: id,
        changes: { queue },
      }),
    )
    return {}
  },
})

/** Runs a webhook event's processing again (it is idempotent). */
export const reprocessWebhook = defineOperation({
  name: "system.reprocessWebhook",
  access: { system: ["operate"] },
  input: z.object({ id: z.uuid() }),
  async handler({ actor }, { id }) {
    return withTransaction(async (tx) => {
      const updated = await tx.execute<{ provider: string }>(sql`
        update webhook_events set status = 'received', last_error = null
        where id = ${id} and status in ('failed', 'received') returning provider`)
      const provider = updated.rows[0]?.provider
      if (!provider) {
        throw new DomainError(
          "INVALID_STATE",
          "Only failed or waiting events can be run again.",
        )
      }
      if (provider === "shiprocket") {
        await enqueue(QUEUES.processTracking, { webhookEventId: id }, { tx })
      } else {
        await enqueue(
          QUEUES.processPaymentWebhook,
          { webhookEventId: id },
          { tx },
        )
      }
      await writeAudit(tx, actor, {
        action: "system.reprocess_webhook",
        entityType: "webhook_event",
        entityId: id,
      })
      return {}
    })
  },
})

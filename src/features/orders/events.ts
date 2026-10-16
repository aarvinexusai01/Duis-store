import "server-only"
import { sql } from "drizzle-orm"

import {
  applyRefundResult,
  markAttemptFailed,
  type GatewayPayment,
} from "@/features/payments"
import { getDb } from "@/server/db/client"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"
import { logger } from "@/server/observability/logger"

import { settleCapturedPayment } from "./lifecycle"

type RazorpayEntity = {
  id: string
  order_id: string
  status: GatewayPayment["status"]
  amount: number
  currency: string
  method?: string
  error_code?: string | null
  error_description?: string | null
}

type WebhookPayload = {
  event: string
  payload?: {
    payment?: { entity: RazorpayEntity }
    refund?: {
      entity: { id: string; status: "pending" | "processed" | "failed" }
    }
  }
}

/**
 * Stores a verified webhook once (deduplicated by the provider's event id)
 * and hands it to the payments.process-webhook job. Returns false for a
 * duplicate, which the route still answers with 200.
 */
export async function recordWebhook(input: {
  provider: string
  eventId: string
  eventType: string
  payload: unknown
}): Promise<boolean> {
  const inserted = await getDb().execute<{ id: string }>(sql`
    insert into webhook_events (provider, event_id, event_type, payload)
    values (${input.provider}, ${input.eventId}, ${input.eventType}, ${JSON.stringify(input.payload)}::jsonb)
    on conflict (provider, event_id) do nothing
    returning id`)
  const id = inserted.rows[0]?.id
  if (id) await enqueue(QUEUES.processPaymentWebhook, { webhookEventId: id })
  return Boolean(id)
}

function toPayment(entity: RazorpayEntity): GatewayPayment {
  return {
    id: entity.id,
    orderId: entity.order_id,
    status: entity.status,
    amountPaise: entity.amount,
    currency: entity.currency,
    method: entity.method ?? null,
    errorCode: entity.error_code ?? null,
    errorReason: entity.error_description ?? null,
  }
}

/**
 * payments.process-webhook job. Every handler is idempotent and ignores
 * events that arrive after a later state (a "failed" after "captured").
 */
export async function processWebhookEvent(
  webhookEventId: string,
): Promise<void> {
  const loaded = await getDb().execute<{
    status: string
    payload: WebhookPayload
    event_type: string
  }>(sql`
    select status, payload, event_type from webhook_events where id = ${webhookEventId}`)
  const event = loaded.rows[0]
  if (!event || event.status === "processed" || event.status === "ignored")
    return

  try {
    const payment = event.payload.payload?.payment?.entity
    const refund = event.payload.payload?.refund?.entity
    let outcome: "processed" | "ignored" = "processed"
    switch (event.event_type) {
      case "payment.captured":
      case "payment.authorized":
      case "order.paid":
        if (!payment) throw new Error("payment entity missing")
        await settleCapturedPayment(
          payment.order_id,
          toPayment(payment),
          "webhook",
        )
        break
      case "payment.failed":
        if (!payment) throw new Error("payment entity missing")
        await markAttemptFailed(payment.order_id, toPayment(payment))
        break
      case "refund.processed":
      case "refund.failed":
        if (!refund) throw new Error("refund entity missing")
        await applyRefundResult(
          null,
          refund.id,
          event.event_type === "refund.processed" ? "processed" : "failed",
        )
        break
      default:
        outcome = "ignored"
    }
    await getDb().execute(sql`
      update webhook_events set status = ${outcome}, processed_at = now(), attempts = attempts + 1, last_error = null
      where id = ${webhookEventId}`)
  } catch (error) {
    await getDb().execute(sql`
      update webhook_events set status = 'failed', attempts = attempts + 1, last_error = ${String(error).slice(0, 500)}
      where id = ${webhookEventId}`)
    logger.warn(
      { err: error, webhookEventId },
      "webhook processing failed; will retry",
    )
    throw error
  }
}

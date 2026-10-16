import { connection, type NextRequest } from "next/server"

import { recordWebhook } from "@/features/orders"
import { getPaymentGateway } from "@/features/payments"
import { logger } from "@/server/observability/logger"

/**
 * Razorpay webhooks (doc/03 §3). The signature is checked on the raw body
 * before anything is parsed; the event is stored once (deduplicated by
 * x-razorpay-event-id) and processed by a job, so the answer is fast and a
 * redelivery is a no-op.
 */
export async function POST(request: NextRequest) {
  await connection()
  const raw = await request.text()
  if (raw.length > 512_000) return new Response(null, { status: 413 })
  const signature = request.headers.get("x-razorpay-signature") ?? ""
  const gateway = getPaymentGateway()
  if (!gateway.verifyWebhookSignature(raw, signature)) {
    logger.warn(
      { requestId: request.headers.get("x-request-id") },
      "webhook signature rejected",
    )
    return new Response(null, { status: 401 })
  }
  let payload: { event?: unknown }
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  const eventId = request.headers.get("x-razorpay-event-id")
  if (typeof payload.event !== "string" || !eventId || eventId.length > 100) {
    return new Response(null, { status: 400 })
  }
  await recordWebhook({
    provider: gateway.name,
    eventId,
    eventType: payload.event,
    payload,
  })
  return Response.json({ ok: true })
}

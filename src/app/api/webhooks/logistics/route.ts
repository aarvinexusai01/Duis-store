import { timingSafeEqual } from "node:crypto"

import { connection, type NextRequest } from "next/server"

import { getServerEnv } from "@/config/env"
import { recordTrackingWebhook } from "@/features/shipping"
import { logger } from "@/server/observability/logger"

/**
 * Courier tracking webhooks (doc/03 §6). The path avoids carrier brand words
 * (Shiprocket refuses some URLs). The shared token in x-api-key is checked
 * first; the event is stored once and processed by a job.
 */
export async function POST(request: NextRequest) {
  await connection()
  const expected = getServerEnv().SHIPROCKET_WEBHOOK_TOKEN
  if (!expected) return new Response(null, { status: 404 })
  const given = Buffer.from(request.headers.get("x-api-key") ?? "")
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    logger.warn(
      { requestId: request.headers.get("x-request-id") },
      "tracking webhook token rejected",
    )
    return new Response(null, { status: 401 })
  }
  const raw = await request.text()
  if (raw.length > 256_000) return new Response(null, { status: 413 })
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  // Unknown shapes are acknowledged (200) so the courier doesn't retry them.
  await recordTrackingWebhook(payload)
  return Response.json({ ok: true })
}

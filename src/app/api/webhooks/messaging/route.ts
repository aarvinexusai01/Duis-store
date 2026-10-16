import { timingSafeEqual } from "node:crypto"

import { connection, type NextRequest } from "next/server"

import { getServerEnv } from "@/config/env"
import { logger } from "@/server/observability/logger"
import { optOutWhatsApp } from "@/server/notifications/whatsapp"

const STOP = /^\s*(stop|unsubscribe|stop all|cancel)\s*[.!]?\s*$/i

/**
 * Inbound WhatsApp messages (MSG91 webhook): a "STOP" reply turns WhatsApp
 * off for that number. UNVERIFIED payload shape until the account exists
 * (doc/10 A3): the common field names are accepted. The shared token is in
 * the x-webhook-token header.
 */
export async function POST(request: NextRequest) {
  await connection()
  const expected = getServerEnv().WHATSAPP_WEBHOOK_TOKEN
  if (!expected) return new Response(null, { status: 404 })
  const given = Buffer.from(request.headers.get("x-webhook-token") ?? "")
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return new Response(null, { status: 401 })
  }
  const raw = await request.text()
  if (raw.length > 64_000) return new Response(null, { status: 413 })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return new Response(null, { status: 400 })
  }
  const from = [body.customerNumber, body.from, body.sender, body.mobile].find(
    (v): v is string => typeof v === "string" && /\d{10,15}/.test(v),
  )
  const content = body.content as { text?: unknown } | undefined
  const text = [body.text, content?.text, body.message].find(
    (v): v is string => typeof v === "string",
  )
  if (from && text && STOP.test(text)) {
    const phone = `+${from.replace(/\D/g, "")}`
    const changed = await optOutWhatsApp(phone)
    logger.info({ changed }, "WhatsApp opt-out received")
  }
  // Every other message is acknowledged; replies are handled in the MSG91 inbox.
  return Response.json({ ok: true })
}

import "server-only"
import { eq, sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { notificationLogs } from "@/db/schema"
import { maskPhone } from "@/lib/mask"
import { getDb } from "@/server/db/client"
import type { Transaction } from "@/server/db/transaction"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES, type JobPayloads } from "@/server/jobs/queues"
import { logger } from "@/server/observability/logger"

/**
 * WhatsApp updates (doc/06 Phase 5 §3, owner decisions 2026-10-16): order
 * and exchange updates and back-in-stock alerts, only to customers who opted
 * in, always alongside the email. Business-initiated WhatsApp messages must
 * use templates approved by Meta, so each message names its template and
 * fills its numbered placeholders in order.
 */
export const WHATSAPP_TEMPLATES = {
  order_confirmed: {
    name: "duis_order_confirmed",
    params: ["name", "orderNumber", "total"],
    urgent: true,
  },
  order_shipped: {
    name: "duis_order_shipped",
    params: ["name", "orderNumber", "courier", "awb", "trackingUrl"],
    urgent: true,
  },
  order_out_for_delivery: {
    name: "duis_out_for_delivery",
    params: ["name", "orderNumber", "trackingUrl"],
    urgent: true,
  },
  order_delivered: {
    name: "duis_order_delivered",
    params: ["name", "orderNumber"],
    urgent: true,
  },
  exchange_update: {
    name: "duis_exchange_update",
    params: ["name", "exchangeNumber", "headline"],
    urgent: true,
  },
  // Waits for the morning (quiet hours 21:00–09:00 IST).
  back_in_stock: {
    name: "duis_back_in_stock",
    params: ["product", "url"],
    urgent: false,
  },
} as const

export type WhatsAppTemplate = keyof typeof WHATSAPP_TEMPLATES
type Params<T extends WhatsAppTemplate> = Record<
  (typeof WHATSAPP_TEMPLATES)[T]["params"][number],
  string
>

/** The next 09:00 IST if `now` is in quiet hours, else null. */
export function quietHoursEnd(now: Date = new Date()): Date | null {
  const ist = new Date(now.getTime() + 5.5 * 3600_000)
  const hour = ist.getUTCHours()
  if (hour >= 9 && hour < 21) return null
  const morning = new Date(ist)
  if (hour >= 21) morning.setUTCDate(morning.getUTCDate() + 1)
  morning.setUTCHours(9, 0, 0, 0)
  return new Date(morning.getTime() - 5.5 * 3600_000)
}

/**
 * The number to message, if this customer opted in to WhatsApp updates:
 * their verified mobile, else the phone on the order.
 */
async function consentedPhone(
  db: Transaction,
  userId: string,
  fallbackPhone: string | null,
): Promise<string | null> {
  const found = await db.execute<{
    phone: string | null
    consent: boolean
  }>(sql`
    select case when u.phone_number_verified then u.phone_number end as phone,
           cp.whatsapp_updates_consent_at is not null as consent
    from users u left join customer_profiles cp on cp.user_id = u.id
    where u.id = ${userId}`)
  const row = found.rows[0]
  if (!row?.consent) return null
  const phone = row.phone ?? fallbackPhone
  return phone && /^\+\d{10,15}$/.test(phone) ? phone : null
}

/**
 * Queues a WhatsApp update for a customer, if WhatsApp is on and they opted
 * in. Inside `tx`, the message exists only if the business change commits.
 */
export async function queueWhatsApp<T extends WhatsAppTemplate>(
  tx: Transaction,
  input: {
    template: T
    userId: string
    fallbackPhone?: string | null
    params: Params<T>
    reference?: { type: string; id: string }
  },
): Promise<string | null> {
  if (getServerEnv().WHATSAPP_PROVIDER === "off") return null
  const to = await consentedPhone(tx, input.userId, input.fallbackPhone ?? null)
  if (!to) return null
  const template = WHATSAPP_TEMPLATES[input.template]
  const values = template.params.map((key) =>
    String((input.params as Record<string, string>)[key] ?? "").slice(0, 200),
  )
  const [log] = await tx
    .insert(notificationLogs)
    .values({
      channel: "whatsapp",
      template: input.template,
      recipient: maskPhone(to),
      userId: input.userId,
      referenceType: input.reference?.type ?? null,
      referenceId: input.reference?.id ?? null,
    })
    .returning({ id: notificationLogs.id })
  const later = template.urgent ? null : quietHoursEnd()
  await enqueue(
    QUEUES.notifyWhatsApp,
    { notificationId: log!.id, template: input.template, to, params: values },
    { tx, ...(later ? { startAfter: later } : {}) },
  )
  return log!.id
}

// --- Delivery (worker) -----------------------------------------------------------------

type Sent = { to: string; template: string; params: string[] }
const globalForWhatsApp = globalThis as typeof globalThis & {
  __duisFakeWhatsApp?: Sent[]
}

/** Messages the fake provider "sent" (tests only). */
export function fakeWhatsAppOutbox(): Sent[] {
  return globalForWhatsApp.__duisFakeWhatsApp ?? []
}

interface WhatsAppProvider {
  readonly name: string
  send(message: Sent & { templateName: string }): Promise<string>
}

const fakeProvider: WhatsAppProvider = {
  name: "fake",
  async send(message) {
    const outbox = (globalForWhatsApp.__duisFakeWhatsApp ??= [])
    outbox.push(message)
    if (outbox.length > 100) outbox.shift()
    logger.info(
      { to: maskPhone(message.to), template: message.templateName },
      "fake WhatsApp provider: message not sent (development only)",
    )
    return `fake-${crypto.randomUUID()}`
  },
}

/**
 * MSG91's WhatsApp template API (owner decision 2026-10-16). UNVERIFIED
 * until the WhatsApp Business account and template approvals exist
 * (doc/10 A3): field names follow MSG91's documentation.
 */
const msg91Provider: WhatsAppProvider = {
  name: "msg91",
  async send(message) {
    const env = getServerEnv()
    const components = Object.fromEntries(
      message.params.map((value, i) => [
        `body_${i + 1}`,
        { type: "text", value },
      ]),
    )
    const response = await fetch(
      "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
      {
        method: "POST",
        headers: {
          authkey: env.WHATSAPP_API_KEY!,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          integrated_number: env.WHATSAPP_NUMBER,
          content_type: "template",
          payload: {
            messaging_product: "whatsapp",
            type: "template",
            template: {
              name: message.templateName,
              language: { code: "en", policy: "deterministic" },
              namespace: env.WHATSAPP_TEMPLATE_NAMESPACE,
              to_and_components: [
                { to: [message.to.replace(/^\+/, "")], components },
              ],
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    const body = (await response.json().catch(() => ({}))) as {
      status?: string
      request_id?: string
      errors?: unknown
    }
    if (!response.ok || body.status === "fail") {
      throw new Error(`MSG91 WhatsApp send failed: HTTP ${response.status}`)
    }
    return body.request_id ?? `msg91-${Date.now()}`
  },
}

/** notify.whatsapp handler: send, then record the outcome. */
export async function deliverWhatsApp(
  payload: JobPayloads["notify.whatsapp"],
): Promise<void> {
  const env = getServerEnv()
  const provider =
    env.WHATSAPP_PROVIDER === "msg91" ? msg91Provider : fakeProvider
  const template = WHATSAPP_TEMPLATES[payload.template as WhatsAppTemplate]
  const db = getDb()
  try {
    const id = await provider.send({
      to: payload.to,
      template: payload.template,
      templateName: template.name,
      params: payload.params,
    })
    await db
      .update(notificationLogs)
      .set({
        status: "sent",
        provider: provider.name,
        providerMessageId: id,
        attempts: sql`${notificationLogs.attempts} + 1`,
        error: null,
        sentAt: new Date(),
      })
      .where(eq(notificationLogs.id, payload.notificationId))
  } catch (err) {
    await db
      .update(notificationLogs)
      .set({
        attempts: sql`${notificationLogs.attempts} + 1`,
        error: (err as Error).message.slice(0, 500),
      })
      .where(eq(notificationLogs.id, payload.notificationId))
    throw err
  }
}

/**
 * Inbound "STOP" (MSG91 webhook): turn off WhatsApp for that number, both
 * updates and marketing. Returns how many customers it applied to.
 */
export async function optOutWhatsApp(phone: string): Promise<number> {
  const result = await getDb().execute<{ user_id: string }>(sql`
    update customer_profiles set whatsapp_updates_consent_at = null,
      marketing_whatsapp_consent_at = null, updated_at = now()
    where user_id in (select id from users where phone_number = ${phone})
    returning user_id`)
  return result.rows.length
}

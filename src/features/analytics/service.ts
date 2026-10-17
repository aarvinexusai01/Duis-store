import "server-only"
import { createHash } from "node:crypto"

import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { getDb } from "@/server/db/client"
import type { Transaction } from "@/server/db/transaction"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"
import { defineOperation } from "@/server/operation"

import { CONSENT_VERSION } from "./consent"

/**
 * Appends a cookie consent answer (DPDP: proof of what was agreed, and
 * when). The visitor ID is random; no IP address is stored.
 */
export const recordConsent = defineOperation({
  name: "analytics.recordConsent",
  access: "public",
  input: z.object({
    visitorId: z.uuid(),
    analytics: z.boolean(),
    marketing: z.boolean(),
    source: z.enum(["banner", "settings"]),
    userAgent: z.string().max(500).optional(),
  }),
  async handler({ actor }, input) {
    await getDb().execute(sql`
      insert into consent_records (visitor_id, user_id, analytics, marketing, version, source, user_agent)
      values (${input.visitorId}, ${actor.kind === "user" ? actor.userId : null}, ${input.analytics},
              ${input.marketing}, ${CONSENT_VERSION}, ${input.source}, ${input.userAgent ?? null})`)
    return {}
  },
})

// --- Meta Conversions API ------------------------------------------------------------

/** The browser Pixel uses the same ID, so Meta counts the purchase once. */
export function purchaseEventId(orderNumber: string): string {
  return `purchase-${orderNumber}`
}

/**
 * Called when an order is confirmed (inside that transaction): queue the
 * server-side Purchase if the buyer gave marketing consent at checkout and
 * the Conversions API is configured.
 */
export async function queueMetaPurchase(
  tx: Transaction,
  orderId: string,
): Promise<void> {
  if (!getServerEnv().META_CAPI_ACCESS_TOKEN) return
  const found = await tx.execute<{ id: string }>(sql`
    select id from orders where id = ${orderId} and marketing_context is not null`)
  if (!found.rows[0]) return
  await enqueue(QUEUES.metaPurchase, { orderId }, { tx })
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

/** Meta's normalisation rules, then SHA-256. Empty values are left out. */
function hashed(
  value: string | null | undefined,
  normalise: (v: string) => string,
) {
  const clean = value ? normalise(value) : ""
  return clean ? [sha256(clean)] : undefined
}

const lettersOnly = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "")

export type MetaEvent = {
  event_name: "Purchase"
  event_time: number
  event_id: string
  action_source: "website"
  event_source_url: string
  user_data: Record<string, string | string[] | undefined>
  custom_data: {
    currency: "INR"
    value: number
    order_id: string
    content_type: "product"
    content_ids: string[]
    contents: { id: string; quantity: number; item_price: number }[]
    num_items: number
  }
}

/**
 * The Purchase event for one order, or null if it must not be sent (no
 * consent recorded, or not confirmed). Only hashed identifiers, Meta's
 * browser cookies and the user agent; never the IP address.
 */
export async function buildMetaPurchase(
  orderId: string,
): Promise<MetaEvent | null> {
  const db = getDb()
  const found = await db.execute<{
    order_number: string
    user_id: string
    total_paise: number
    confirmed_at: Date | null
    customer_email: string | null
    customer_phone: string | null
    shipping_address: {
      city?: string
      stateCode?: string | null
      region?: string | null
      postalCode?: string
      countryCode?: string
    }
    marketing_context: {
      fbp?: string
      fbc?: string
      userAgent?: string
    } | null
  }>(sql`
    select order_number, user_id, total_paise, confirmed_at, customer_email, customer_phone,
           shipping_address, marketing_context
    from orders where id = ${orderId}`)
  const order = found.rows[0]
  if (!order?.marketing_context || !order.confirmed_at) return null
  const items = await db.execute<{
    product_id: string | null
    quantity: number
    unit_price_paise: number
  }>(sql`
    select product_id, quantity, unit_price_paise from order_items
    where order_id = ${orderId} order by position`)
  const lines = items.rows.filter((i) => i.product_id)
  const context = order.marketing_context
  const address = order.shipping_address
  const email =
    order.customer_email && !order.customer_email.endsWith(".invalid")
      ? order.customer_email
      : null

  return {
    event_name: "Purchase",
    event_time: Math.floor(new Date(order.confirmed_at).getTime() / 1000),
    event_id: purchaseEventId(order.order_number),
    action_source: "website",
    event_source_url: new URL(
      `/checkout/success/${order.order_number}`,
      getServerEnv().APP_URL,
    ).toString(),
    user_data: {
      em: hashed(email, (v) => v.trim().toLowerCase()),
      ph: hashed(order.customer_phone, (v) => v.replace(/\D/g, "")),
      external_id: hashed(order.user_id, (v) => v),
      ct: hashed(address.city, lettersOnly),
      st: hashed(
        address.stateCode?.replace(/^[A-Z]{2}-/, "") ?? address.region,
        lettersOnly,
      ),
      zp: hashed(address.postalCode, (v) => v.toLowerCase().replace(/\s/g, "")),
      country: hashed(address.countryCode, lettersOnly),
      fbp: context.fbp,
      fbc: context.fbc,
      client_user_agent: context.userAgent,
    },
    custom_data: {
      currency: "INR",
      value: order.total_paise / 100,
      order_id: order.order_number,
      content_type: "product",
      content_ids: lines.map((l) => l.product_id!),
      contents: lines.map((l) => ({
        id: l.product_id!,
        quantity: l.quantity,
        item_price: l.unit_price_paise / 100,
      })),
      num_items: lines.reduce((sum, l) => sum + l.quantity, 0),
    },
  }
}

// Graph API versions stay available for about two years after release.
const GRAPH_VERSION = "v23.0"

/**
 * analytics.meta-purchase job. UNVERIFIED until the Pixel and token exist
 * (doc/10 A11): set META_CAPI_TEST_EVENT_CODE to see events under Events
 * Manager → Test events first.
 */
export async function sendMetaPurchase(orderId: string): Promise<boolean> {
  const env = getServerEnv()
  if (!env.META_PIXEL_ID || !env.META_CAPI_ACCESS_TOKEN) return false
  const event = await buildMetaPurchase(orderId)
  if (!event) return false
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${env.META_PIXEL_ID}/events`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: [event],
        access_token: env.META_CAPI_ACCESS_TOKEN,
        ...(env.META_CAPI_TEST_EVENT_CODE
          ? { test_event_code: env.META_CAPI_TEST_EVENT_CODE }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(
      `Meta Conversions API: HTTP ${response.status} ${body.error?.message ?? ""}`.trim(),
    )
  }
  return true
}

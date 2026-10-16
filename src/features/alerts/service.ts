import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"
import { queueEmail } from "@/server/notifications/email"
import { queueWhatsApp } from "@/server/notifications/whatsapp"
import { defineOperation } from "@/server/operation"

/**
 * Back-in-stock alerts (doc/06 Phase 5 §6): "Notify me" on a sold-out size.
 * When stock returns, one batched email per address (and WhatsApp for
 * signed-in customers who opted in, after quiet hours). Each alert is sent
 * once and then ends, so there is nothing to unsubscribe from. The answer
 * is the same whether or not an alert already existed, so the form reveals
 * nothing about other people.
 */

const BATCH = 200

const VARIANT_LABEL = sql`(select string_agg(av.label, ' / ' order by pa.position)
  from variant_attribute_values vav
  join attribute_values av on av.id = vav.attribute_value_id
  left join product_attributes pa on pa.product_id = v.product_id and pa.attribute_id = vav.attribute_id
  where vav.variant_id = v.id)`

export const subscribeStockAlert = defineOperation({
  name: "alerts.subscribe",
  access: "public",
  input: z.object({
    variantId: z.uuid(),
    email: z.email("Enter a valid email.").trim().toLowerCase().max(200),
  }),
  async handler(
    { actor },
    input,
  ): Promise<{ status: "subscribed" | "in_stock" }> {
    const db = getDb()
    const found = await db.execute<{ available: number }>(sql`
      select coalesce((select sum(l.on_hand - l.reserved) from inventory_levels l where l.variant_id = v.id), 0)::int as available
      from product_variants v join products p on p.id = v.product_id
      where v.id = ${input.variantId} and v.status = 'active' and p.status = 'active'`)
    const variant = found.rows[0]
    if (!variant) throw new DomainError("NOT_FOUND", "Product not found.")
    if (variant.available > 0) return { status: "in_stock" }
    const userId = actor.kind === "user" ? actor.userId : null
    const whatsapp = userId
      ? Boolean(
          (
            await db.execute<{ on: boolean }>(sql`
              select whatsapp_updates_consent_at is not null as on from customer_profiles where user_id = ${userId}`)
          ).rows[0]?.on,
        )
      : false
    await db.execute(sql`
      insert into stock_alerts (variant_id, user_id, email, whatsapp)
      values (${input.variantId}, ${userId}, ${input.email}, ${whatsapp})
      on conflict (variant_id, email) where notified_at is null do nothing`)
    return { status: "subscribed" }
  },
})

/**
 * Called when stock changes (inside that transaction): queue a send for any
 * size with people waiting. The job checks the stock is really back.
 */
export async function queueBackInStock(
  tx: Transaction,
  variantIds: string[],
): Promise<void> {
  if (variantIds.length === 0) return
  const waiting = await tx.execute<{ variant_id: string }>(sql`
    select distinct variant_id from stock_alerts
    where notified_at is null and variant_id in (${sql.join(
      variantIds.map((id) => sql`${id}`),
      sql`, `,
    )})`)
  for (const row of waiting.rows) {
    await enqueue(
      QUEUES.backInStock,
      { variantId: row.variant_id },
      { tx, singletonKey: `back-in-stock:${row.variant_id}` },
    )
  }
}

/** alerts.back-in-stock job: one batch; queues itself again if more remain. */
export async function sendBackInStock(variantId: string): Promise<number> {
  const db = getDb()
  const found = await db.execute<{
    available: number
    title: string
    slug: string
    label: string | null
    options: Record<string, string> | null
  }>(sql`
    select coalesce((select sum(l.on_hand - l.reserved) from inventory_levels l where l.variant_id = v.id), 0)::int as available,
           p.title, p.slug::text, ${VARIANT_LABEL} as label,
           (select json_object_agg(a.code, av.slug) from variant_attribute_values vav
            join attributes a on a.id = vav.attribute_id
            join attribute_values av on av.id = vav.attribute_value_id
            where vav.variant_id = v.id) as options
    from product_variants v join products p on p.id = v.product_id
    where v.id = ${variantId} and v.status = 'active' and p.status = 'active'`)
  const variant = found.rows[0]
  if (!variant || variant.available <= 0) return 0
  const url = new URL(`/products/${variant.slug}`, getServerEnv().APP_URL)
  for (const [key, value] of Object.entries(variant.options ?? {}))
    url.searchParams.set(key, value)
  let sent = 0
  await withTransaction(async (tx) => {
    const alerts = await tx.execute<{
      id: string
      user_id: string | null
      email: string
      whatsapp: boolean
    }>(sql`
      select id, user_id, email, whatsapp from stock_alerts
      where variant_id = ${variantId} and notified_at is null
      order by created_at limit ${BATCH} for update skip locked`)
    for (const alert of alerts.rows) {
      await tx.execute(
        sql`update stock_alerts set notified_at = now() where id = ${alert.id}`,
      )
      await queueEmail(
        {
          template: "back-in-stock",
          to: alert.email,
          userId: alert.user_id,
          reference: { type: "stock_alert", id: alert.id },
          props: {
            product: variant.title,
            variant: variant.label ?? "",
            url: url.toString(),
          },
        },
        { tx },
      )
      if (alert.whatsapp && alert.user_id) {
        await queueWhatsApp(tx, {
          template: "back_in_stock",
          userId: alert.user_id,
          params: {
            product: `${variant.title}${variant.label ? ` (${variant.label})` : ""}`,
            url: url.toString(),
          },
          reference: { type: "stock_alert", id: alert.id },
        })
      }
      sent += 1
    }
    if (alerts.rows.length === BATCH) {
      await enqueue(QUEUES.backInStock, { variantId }, { tx, startAfter: 60 })
    }
  })
  return sent
}

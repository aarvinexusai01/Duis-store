import "server-only"
import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import type { Actor } from "@/server/auth/actor"
import type { Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { queueEmail } from "@/server/notifications/email"
import { queueWhatsApp } from "@/server/notifications/whatsapp"

/**
 * Shared pieces of the exchange flow (doc/03 §7): loading and locking an
 * exchange, recording a status change, and telling the customer.
 */

export type ExchangeStatus =
  | "requested"
  | "awaiting_payment"
  | "approved"
  | "rejected"
  | "cancelled"
  | "pickup_scheduled"
  | "picked_up"
  | "received"
  | "qc_passed"
  | "qc_failed"
  | "replacement_shipped"
  | "completed"

export type ExchangeRow = {
  id: string
  exchange_number: string
  order_id: string
  order_number: string
  order_item_id: string
  user_id: string
  quantity: number
  requested_variant_id: string
  original_variant_id: string | null
  status: ExchangeStatus
  price_difference_paise: number
  difference_payment_id: string | null
  customer_name: string
  customer_email: string | null
}

const COLUMNS = sql`e.id, e.exchange_number, e.order_id, o.order_number, e.order_item_id, e.user_id,
  e.quantity, e.requested_variant_id, oi.variant_id as original_variant_id, e.status,
  e.price_difference_paise, e.difference_payment_id, o.customer_name, o.customer_email`

export async function lockExchange(
  tx: Transaction,
  where: { id: string } | { number: string },
): Promise<ExchangeRow> {
  const found = await tx.execute<ExchangeRow>(sql`
    select ${COLUMNS} from exchange_requests e
    join orders o on o.id = e.order_id
    join order_items oi on oi.id = e.order_item_id
    where ${"id" in where ? sql`e.id = ${where.id}` : sql`e.exchange_number = ${where.number}`}
    for update of e`)
  const row = found.rows[0]
  if (!row) throw new DomainError("NOT_FOUND", "Exchange not found.")
  return row
}

export function requireStatus(
  row: ExchangeRow,
  allowed: ExchangeStatus[],
  message: string,
) {
  if (!allowed.includes(row.status))
    throw new DomainError("INVALID_STATE", message)
}

export async function setStatus(
  tx: Transaction,
  row: ExchangeRow,
  status: ExchangeStatus,
  extra: { note?: string; field?: "decision" | "qc"; actor?: Actor } = {},
) {
  await tx.execute(sql`
    update exchange_requests set status = ${status}::exchange_status,
      ${extra.field === "decision" ? sql`decision_note = ${extra.note ?? null}, decided_at = now(), decided_by = ${extra.actor?.kind === "user" ? extra.actor.userId : null},` : sql``}
      ${extra.field === "qc" ? sql`qc_note = ${extra.note ?? null},` : sql``}
      completed_at = case when ${status} in ('completed', 'qc_failed', 'rejected', 'cancelled') then now() else completed_at end,
      updated_at = now()
    where id = ${row.id}`)
  row.status = status
}

export function exchangeUrl(row: Pick<ExchangeRow, "order_number">) {
  return new URL(
    `/account/orders/${row.order_number}/exchange`,
    getServerEnv().APP_URL,
  ).toString()
}

/** One email per step, in the customer's words. */
export async function notifyCustomer(
  tx: Transaction,
  row: ExchangeRow,
  headline: string,
  message: string,
) {
  await queueWhatsApp(tx, {
    template: "exchange_update",
    userId: row.user_id,
    params: {
      name: row.customer_name,
      exchangeNumber: row.exchange_number,
      headline,
    },
    reference: { type: "exchange", id: row.id },
  })
  if (!row.customer_email || row.customer_email.endsWith(".invalid")) return
  await queueEmail(
    {
      template: "exchange-update",
      to: row.customer_email,
      userId: row.user_id,
      reference: { type: "exchange", id: row.id },
      props: {
        name: row.customer_name,
        exchangeNumber: row.exchange_number,
        headline,
        message: message.slice(0, 600),
        url: exchangeUrl(row),
      },
    },
    { tx },
  )
}

/** The parcel size for an exchange: the item's weight plus packaging. */
export async function parcelWeight(
  tx: Transaction,
  row: ExchangeRow,
): Promise<number> {
  const found = await tx.execute<{ grams: number }>(sql`
    select coalesce(v.weight_grams_override, p.weight_grams, 300) as grams
    from product_variants v join products p on p.id = v.product_id
    where v.id = ${row.requested_variant_id}`)
  return (found.rows[0]?.grams ?? 300) * row.quantity + 150
}

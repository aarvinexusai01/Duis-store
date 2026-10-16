import "server-only"
import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { restockCommitted } from "@/features/inventory"
import { requestRefund } from "@/features/payments"
import {
  onShipmentStatusChanged,
  type ShipmentStatus,
  type ShipmentStatusChange,
} from "@/features/shipping"
import { creditWallet, reverseDebit } from "@/features/wallet"
import { formatPaise } from "@/lib/money"
import type { Transaction } from "@/server/db/transaction"
import { queueEmail } from "@/server/notifications/email"

import { lockOrder, recordChange, walletKey } from "./lifecycle"

/**
 * Parcel → order (doc/03 §5). The order follows its parcel forward and never
 * back; a returned parcel restocks the items and applies the RTO advance
 * policy (doc/01 decision 21: the advance is kept by default).
 */
const ORDER_FOR: Partial<Record<ShipmentStatus, string>> = {
  ready_to_ship: "processing",
  picked_up: "shipped",
  in_transit: "shipped",
  undelivered: "shipped",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  rto_initiated: "rto_initiated",
  rto_delivered: "rto_delivered",
}

const ORDER_RANK: Record<string, number> = {
  confirmed: 1,
  processing: 2,
  shipped: 3,
  out_for_delivery: 4,
  delivered: 5,
  rto_initiated: 5,
  rto_delivered: 6,
}

/** The order status a parcel change leads to, or null to leave it. */
export function orderStatusAfter(
  current: string,
  shipment: ShipmentStatus,
): string | null {
  const target = ORDER_FOR[shipment]
  const from = ORDER_RANK[current]
  if (!target || from === undefined) return null
  return ORDER_RANK[target]! > from ? target : null
}

async function applyShipmentChange(
  tx: Transaction,
  change: ShipmentStatusChange,
): Promise<void> {
  const order = await lockOrder(tx, change.orderId)
  const next = orderStatusAfter(order.status, change.to)
  if (!next) return
  const fulfilled = ["shipped", "out_for_delivery", "delivered"].includes(next)
  const returned = next === "rto_delivered"
  const current = await tx.execute<{ fulfillment_status: string }>(
    sql`select fulfillment_status from orders where id = ${order.id}`,
  )
  const fulfillmentFrom = current.rows[0]!.fulfillment_status
  const fulfillmentTo = returned
    ? "returned"
    : fulfilled || next === "rto_initiated"
      ? "fulfilled"
      : fulfillmentFrom
  await tx.execute(sql`
    update orders set status = ${next}::order_status,
      fulfillment_status = ${fulfillmentTo}::fulfillment_status, updated_at = now()
    where id = ${order.id}`)
  await recordChange(tx, order.id, {
    field: "status",
    from: order.status,
    to: next,
    actor: change.actor,
    reason: `parcel_${change.to}`,
  })
  await recordChange(tx, order.id, {
    field: "fulfillment_status",
    from: fulfillmentFrom,
    to: fulfillmentTo,
    actor: change.actor,
  })

  if (next === "shipped" && order.status !== "shipped") {
    await emailShipped(tx, order, change.shipmentId)
  }
  if (returned) await handleReturn(tx, order)
}

async function emailShipped(
  tx: Transaction,
  order: Awaited<ReturnType<typeof lockOrder>>,
  shipmentId: string,
) {
  if (!order.customer_email || order.customer_email.endsWith(".invalid")) return
  const parcel = await tx.execute<{ awb: string; courier_name: string }>(
    sql`select awb, courier_name from shipments where id = ${shipmentId}`,
  )
  const row = parcel.rows[0]
  if (!row?.awb) return
  await queueEmail(
    {
      template: "order-shipped",
      to: order.customer_email,
      userId: order.user_id,
      reference: { type: "order", id: order.id },
      props: {
        name: order.customer_name,
        orderNumber: order.order_number,
        url: new URL(
          `/account/orders/${order.order_number}`,
          getServerEnv().APP_URL,
        ).toString(),
        courier: row.courier_name ?? "our courier",
        awb: row.awb,
        ...(order.cod_due_paise > 0
          ? { codDue: formatPaise(order.cod_due_paise) }
          : {}),
      },
    },
    { tx },
  )
}

/**
 * The parcel came back: restock, and for partial COD apply the advance
 * policy. Prepaid returns are refunded by staff, who decide what is due.
 */
async function handleReturn(
  tx: Transaction,
  order: Awaited<ReturnType<typeof lockOrder>>,
) {
  await restockCommitted(tx, order.id, "rto_restock")
  if (order.payment_mode !== "partial_cod") return
  const settings = await tx.execute<{ policy: "keep" | "refund" | "wallet" }>(
    sql`select rto_advance_policy as policy from store_settings where id = 1`,
  )
  const policy = settings.rows[0]?.policy ?? "keep"
  if (policy === "keep") return
  // The wallet part of the advance goes back to the wallet either way.
  for (const key of [walletKey(order.id), `${walletKey(order.id)}:late`]) {
    await reverseDebit(tx, {
      debitIdempotencyKey: key,
      reason: "cancellation_refund",
    })
  }
  const paid = await tx.execute<{
    id: string
    amount_paise: number
    refunded_paise: number
  }>(sql`
    select id, amount_paise, refunded_paise from payments
    where order_id = ${order.id} and status in ('captured', 'partially_refunded')`)
  for (const payment of paid.rows) {
    const amount = payment.amount_paise - payment.refunded_paise
    if (amount <= 0) continue
    if (policy === "refund") {
      await requestRefund(tx, {
        paymentId: payment.id,
        orderId: order.id,
        amountPaise: amount,
        reason: "rto_advance_refund",
        idempotencyKey: `rto:${order.id}:${payment.id}`,
      })
    } else {
      await creditWallet(tx, {
        userId: order.user_id,
        amountPaise: amount,
        reason: "rto_advance_credit",
        reference: { type: "order", id: order.id },
        idempotencyKey: `rto:${order.id}:${payment.id}`,
        note: `Advance for ${order.order_number}`,
      })
    }
  }
}

onShipmentStatusChanged(applyShipmentChange)

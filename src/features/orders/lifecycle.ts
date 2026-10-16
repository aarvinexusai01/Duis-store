import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { redeemCoupon, reverseCouponRedemption } from "@/features/discounts"
import {
  commitReservations,
  releaseReservations,
  reserveStock,
  restockCommitted,
} from "@/features/inventory"
import {
  captureIfAuthorized,
  paymentGatewayFor,
  lockPaymentByProviderOrder,
  markCaptured,
  onRefundProcessed,
  requestRefund,
  type GatewayPayment,
} from "@/features/payments"
import { debitWallet, reverseDebit } from "@/features/wallet"
import { formatPaise } from "@/lib/money"
import { systemActor, type Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { queueEmail } from "@/server/notifications/email"
import { queueWhatsApp } from "@/server/notifications/whatsapp"
import { logger } from "@/server/observability/logger"
import { defineOperation } from "@/server/operation"

/**
 * Order state changes after placement (doc/03 §3–5). Every path that can see
 * a payment — the browser callback, the webhook and the reconciler — ends in
 * settleCapturedPayment(), which is idempotent: whichever arrives second
 * finds the work done.
 */

export type OrderRow = {
  id: string
  order_number: string
  user_id: string
  status: string
  payment_status: string
  payment_mode: "prepaid" | "partial_cod"
  total_paise: number
  online_amount_paise: number
  wallet_applied_paise: number
  cod_due_paise: number
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
  reservation_expires_at: Date | null
}

const ORDER_COLUMNS = sql`id, order_number, user_id, status, payment_status, payment_mode, total_paise,
  online_amount_paise, wallet_applied_paise, cod_due_paise, customer_name, customer_email, customer_phone,
  reservation_expires_at`

export async function lockOrder(
  tx: Transaction,
  orderId: string,
): Promise<OrderRow> {
  const result = await tx.execute<OrderRow>(
    sql`select ${ORDER_COLUMNS} from orders where id = ${orderId} for update`,
  )
  const order = result.rows[0]
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.")
  return order
}

export async function recordChange(
  tx: Transaction,
  orderId: string,
  change: {
    field: "status" | "payment_status" | "fulfillment_status"
    from: string | null
    to: string
    actor: Actor
    reason?: string
  },
): Promise<void> {
  if (change.from === change.to) return
  await tx.execute(sql`
    insert into order_status_history (order_id, field, from_value, to_value, actor_type, actor_user_id, reason)
    values (${orderId}, ${change.field}, ${change.from}, ${change.to}, ${change.actor.kind},
            ${change.actor.kind === "user" ? change.actor.userId : null}, ${change.reason ?? null})`)
}

export const walletKey = (orderId: string) => `order:${orderId}:wallet`

function orderUrl(orderNumber: string) {
  return new URL(
    `/account/orders/${orderNumber}`,
    getServerEnv().APP_URL,
  ).toString()
}

// Phone sign-ups have a placeholder address on a reserved TLD: never email it.
const deliverable = (email: string | null): email is string =>
  Boolean(email) && !email!.endsWith(".invalid")

async function emailConfirmation(tx: Transaction, order: OrderRow) {
  if (!deliverable(order.customer_email)) return
  const lines = await tx.execute<{
    title: string
    variant_label: string
    quantity: number
    line_total_paise: number
  }>(sql`
    select title, variant_label, quantity, line_total_paise from order_items where order_id = ${order.id} order by position`)
  await queueEmail(
    {
      template: "order-confirmed",
      to: order.customer_email,
      userId: order.user_id,
      reference: { type: "order", id: order.id },
      props: {
        name: order.customer_name,
        orderNumber: order.order_number,
        url: orderUrl(order.order_number),
        total: formatPaise(order.total_paise),
        ...(order.cod_due_paise > 0
          ? { codDue: formatPaise(order.cod_due_paise) }
          : {}),
        lines: lines.rows.map((l) => ({
          title: `${l.title} (${l.variant_label})`,
          quantity: l.quantity,
          amount: formatPaise(l.line_total_paise),
        })),
      },
    },
    { tx },
  )
}

async function emailCancellation(
  tx: Transaction,
  order: OrderRow,
  reason: string,
  refundPaise: number,
) {
  if (!deliverable(order.customer_email)) return
  await queueEmail(
    {
      template: "order-cancelled",
      to: order.customer_email,
      userId: order.user_id,
      reference: { type: "order", id: order.id },
      props: {
        name: order.customer_name,
        orderNumber: order.order_number,
        url: orderUrl(order.order_number),
        reason,
        ...(refundPaise > 0 ? { refund: formatPaise(refundPaise) } : {}),
      },
    },
    { tx },
  )
}

/**
 * pending_payment → confirmed: commits the stock, records the payment status,
 * removes the bought items from the customer's bag and sends the email.
 */
export async function confirmInTransaction(
  tx: Transaction,
  order: OrderRow,
  actor: Actor,
): Promise<void> {
  const reservations = await tx.execute<{ id: string }>(sql`
    select id from inventory_reservations where order_id = ${order.id} and status = 'active'`)
  await commitReservations(
    tx,
    reservations.rows.map((r) => r.id),
    { type: "order", id: order.id },
  )
  const paymentStatus =
    order.payment_mode === "partial_cod" && order.cod_due_paise > 0
      ? "partially_paid"
      : "paid"
  await tx.execute(sql`
    update orders set status = 'confirmed', payment_status = ${paymentStatus}::order_payment_status,
      confirmed_at = now(), updated_at = now()
    where id = ${order.id}`)
  await recordChange(tx, order.id, {
    field: "status",
    from: order.status,
    to: "confirmed",
    actor,
  })
  await recordChange(tx, order.id, {
    field: "payment_status",
    from: order.payment_status,
    to: paymentStatus,
    actor,
  })
  await tx.execute(sql`
    delete from cart_items
    where cart_id in (select id from carts where user_id = ${order.user_id} and status = 'active')
      and variant_id in (select variant_id from order_items where order_id = ${order.id} and variant_id is not null)`)
  await emailConfirmation(tx, order)
  await queueWhatsApp(tx, {
    template: "order_confirmed",
    userId: order.user_id,
    fallbackPhone: order.customer_phone,
    params: {
      name: order.customer_name,
      orderNumber: order.order_number,
      total: formatPaise(order.total_paise),
    },
    reference: { type: "order", id: order.id },
  })
}

export type SettleResult =
  | "confirmed"
  | "already_confirmed"
  | "late_confirmed"
  | "refunded_late"
  | "refunded_duplicate"
  | "not_captured"
  | "unknown_order"

/**
 * The single place a captured payment turns into a confirmed order. Checks
 * the amount against our records, then handles every order state: normal,
 * repeated (no-op), duplicate payment (refund) and late payment after
 * expiry (re-reserve, or refund if the stock is gone).
 */
export async function settleCapturedPayment(
  providerOrderId: string,
  rawPayment: GatewayPayment,
  source: "callback" | "webhook" | "reconcile",
): Promise<SettleResult> {
  if (rawPayment.orderId !== providerOrderId) {
    throw new DomainError("CONFLICT", "Payment does not belong to this order.")
  }
  const payment = await captureIfAuthorized(rawPayment)
  if (payment.status !== "captured") return "not_captured"
  const actor = systemActor(`payments.${source}`)

  const result = await withTransaction(async (tx): Promise<SettleResult> => {
    const row = await lockPaymentByProviderOrder(tx, providerOrderId)
    if (!row) return "unknown_order"
    if (row.purpose === "exchange_difference") {
      return settleExchangeDifference(tx, row, payment, actor)
    }
    const order = await lockOrder(tx, row.order_id)
    const sameCapture =
      row.status === "captured" && row.provider_payment_id === payment.id
    const otherCapture =
      row.status === "captured" && row.provider_payment_id !== payment.id
    if (otherCapture) {
      // A second payment on the same gateway order: give it back.
      await requestRefundForDuplicate(tx, row.id, order.id, payment)
      return "refunded_duplicate"
    }
    await markCaptured(tx, row, payment)

    if (order.status === "pending_payment") {
      await confirmInTransaction(tx, order, actor)
      return "confirmed"
    }
    if (order.status === "expired" || order.status === "cancelled") {
      if (sameCapture) return "already_confirmed"
      return lateConfirmOrRefund(tx, order, row.id, payment, actor)
    }
    if (sameCapture) return "already_confirmed"
    // Confirmed already through another gateway order: this one is a duplicate.
    await requestRefundForDuplicate(tx, row.id, order.id, payment)
    return "refunded_duplicate"
  })
  logger.info({ providerOrderId, result, source }, "payment settled")
  return result
}

// Set by the exchanges module: what a paid price difference unlocks.
type ExchangePaymentHandler = (
  tx: Transaction,
  paymentRowId: string,
  actor: Actor,
) => Promise<"confirmed" | "refund">
let exchangePaymentHandler: ExchangePaymentHandler | null = null
export function onExchangeDifferencePaid(handler: ExchangePaymentHandler) {
  exchangePaymentHandler = handler
}

/**
 * A captured exchange price difference: recorded once, then handed to the
 * exchange. If the exchange can no longer use it (cancelled meanwhile), or a
 * second payment arrives, the money goes back.
 */
async function settleExchangeDifference(
  tx: Transaction,
  row: Awaited<ReturnType<typeof lockPaymentByProviderOrder>> & object,
  payment: GatewayPayment,
  actor: Actor,
): Promise<SettleResult> {
  if (row.status === "captured") {
    if (row.provider_payment_id === payment.id) return "already_confirmed"
    await requestRefundForDuplicate(tx, row.id, row.order_id, payment)
    return "refunded_duplicate"
  }
  await markCaptured(tx, row, payment)
  // Registered when the exchanges module loads (cycle-safe dynamic import).
  if (!exchangePaymentHandler) await import("@/features/exchanges")
  if (!exchangePaymentHandler) throw new Error("exchanges module not loaded")
  const outcome = await exchangePaymentHandler(tx, row.id, actor)
  if (outcome === "confirmed") return "confirmed"
  await requestRefund(tx, {
    paymentId: row.id,
    orderId: row.order_id,
    amountPaise: payment.amountPaise,
    reason: "exchange_closed_before_payment",
    idempotencyKey: `exchange-refund:${payment.id}`,
  })
  return "refunded_late"
}

async function requestRefundForDuplicate(
  tx: Transaction,
  paymentRowId: string,
  orderId: string,
  payment: GatewayPayment,
) {
  await tx.execute(sql`
    update payments set provider_payment_id = coalesce(provider_payment_id, ${payment.id}) where id = ${paymentRowId}`)
  await requestRefund(tx, {
    paymentId: paymentRowId,
    orderId,
    amountPaise: payment.amountPaise,
    reason: "duplicate_payment",
    idempotencyKey: `duplicate:${payment.id}`,
  })
}

/**
 * Paid after the reservation expired (doc/03 §3): confirm if the stock,
 * wallet and coupon can all be taken again; otherwise refund in full.
 */
async function lateConfirmOrRefund(
  tx: Transaction,
  order: OrderRow,
  paymentRowId: string,
  payment: GatewayPayment,
  actor: Actor,
): Promise<SettleResult> {
  try {
    await tx.transaction(async (savepoint) => {
      const items = await savepoint.execute<{
        variant_id: string
        quantity: number
      }>(sql`
        select variant_id, quantity from order_items where order_id = ${order.id} and variant_id is not null`)
      await reserveStock(
        savepoint,
        { orderId: order.id },
        items.rows.map((i) => ({
          variantId: i.variant_id,
          quantity: i.quantity,
        })),
        15,
      )
      if (order.wallet_applied_paise > 0) {
        await debitWallet(savepoint, {
          userId: order.user_id,
          amountPaise: order.wallet_applied_paise,
          reference: { type: "order", id: order.id },
          idempotencyKey: `${walletKey(order.id)}:late`,
        })
      }
      const coupon = await savepoint.execute<{
        coupon_id: string
        amount_paise: number
      }>(sql`
        select coupon_id, amount_paise from order_discounts where order_id = ${order.id} and coupon_id is not null`)
      if (coupon.rows[0]) {
        await savepoint.execute(
          sql`delete from coupon_redemptions where order_id = ${order.id} and status = 'reversed'`,
        )
        await redeemCoupon(savepoint, {
          couponId: coupon.rows[0].coupon_id,
          orderId: order.id,
          userId: order.user_id,
          amountPaise: coupon.rows[0].amount_paise,
        })
      }
      await savepoint.execute(sql`
        update orders set status = 'pending_payment', expired_at = null, cancelled_at = null, cancel_reason = null
        where id = ${order.id}`)
      await recordChange(savepoint, order.id, {
        field: "status",
        from: order.status,
        to: "pending_payment",
        actor,
        reason: "paid_after_expiry",
      })
      await confirmInTransaction(
        savepoint,
        { ...order, status: "pending_payment" },
        actor,
      )
    })
    return "late_confirmed"
  } catch (error) {
    logger.warn(
      { err: error, orderId: order.id },
      "late payment could not be honoured; refunding",
    )
    await requestRefund(tx, {
      paymentId: paymentRowId,
      orderId: order.id,
      amountPaise: payment.amountPaise,
      reason: "stock_unavailable_after_payment",
      idempotencyKey: `late-refund:${payment.id}`,
    })
    if (order.status !== "cancelled") {
      await tx.execute(sql`
        update orders set status = 'cancelled', cancelled_at = now(),
          cancel_reason = 'stock_unavailable_after_payment', updated_at = now()
        where id = ${order.id}`)
      await recordChange(tx, order.id, {
        field: "status",
        from: order.status,
        to: "cancelled",
        actor,
        reason: "stock_unavailable_after_payment",
      })
    }
    await emailCancellation(
      tx,
      order,
      "the items sold out before your payment reached us.",
      payment.amountPaise,
    )
    return "refunded_late"
  }
}

/** Confirms an order the wallet paid in full (no gateway involved). */
export async function confirmWalletPaidOrder(
  orderId: string,
  actor: Actor,
): Promise<void> {
  await withTransaction(async (tx) => {
    const order = await lockOrder(tx, orderId)
    if (order.status !== "pending_payment" || order.online_amount_paise !== 0)
      return
    await confirmInTransaction(tx, order, actor)
  })
}

// --- Expiry and reconciliation ------------------------------------------------------

async function capturedOnGateway(
  orderId: string,
): Promise<{ providerOrderId: string; payment: GatewayPayment } | null> {
  const rows = await getDb().execute<{
    provider_order_id: string
    provider: string
  }>(sql`
    select provider_order_id, provider from payments where order_id = ${orderId} and status in ('created', 'failed', 'authorized')`)
  for (const row of rows.rows) {
    const gateway = paymentGatewayFor(row.provider)
    if (!gateway) continue
    const payments = await gateway.fetchOrderPayments(row.provider_order_id)
    const paid = payments.find(
      (p) => p.status === "captured" || p.status === "authorized",
    )
    if (paid) return { providerOrderId: row.provider_order_id, payment: paid }
  }
  return null
}

/**
 * orders.expire-pending job: for each order whose reservation ran out, ask
 * the gateway first (a payment may be on its way); only then release the
 * stock, the wallet debit and the coupon.
 */
export async function expirePendingOrders(
  batchSize = 50,
): Promise<{ expired: number; confirmed: number }> {
  const due = await getDb().execute<{ id: string }>(sql`
    select id from orders
    where status = 'pending_payment' and reservation_expires_at < now() - interval '30 seconds'
    order by reservation_expires_at limit ${batchSize}`)
  let expired = 0
  let confirmed = 0
  const actor = systemActor("orders.expire-pending")
  for (const { id } of due.rows) {
    try {
      const paid = await capturedOnGateway(id)
      if (paid) {
        await settleCapturedPayment(
          paid.providerOrderId,
          paid.payment,
          "reconcile",
        )
        confirmed += 1
        continue
      }
    } catch (error) {
      // Can't reach the gateway: try again next run rather than risk expiring a paid order.
      logger.warn(
        { err: error, orderId: id },
        "payment check failed; expiry postponed",
      )
      continue
    }
    const done = await withTransaction(async (tx) => {
      const order = await lockOrder(tx, id)
      if (order.status !== "pending_payment") return false
      const reservations = await tx.execute<{ id: string }>(sql`
        select id from inventory_reservations where order_id = ${id} and status = 'active'`)
      await releaseReservations(
        tx,
        reservations.rows.map((r) => r.id),
        "expired",
      )
      await reverseDebit(tx, {
        debitIdempotencyKey: walletKey(id),
        reason: "order_reversal",
      })
      await reverseCouponRedemption(tx, id)
      await tx.execute(
        sql`update orders set status = 'expired', expired_at = now(), updated_at = now() where id = ${id}`,
      )
      await recordChange(tx, id, {
        field: "status",
        from: "pending_payment",
        to: "expired",
        actor,
        reason: "payment_not_received",
      })
      const attempted = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from payments where order_id = ${id}`,
      )
      if (attempted.rows[0]!.n > 0 && deliverable(order.customer_email)) {
        await queueEmail(
          {
            template: "order-not-completed",
            to: order.customer_email,
            userId: order.user_id,
            reference: { type: "order", id },
            props: {
              name: order.customer_name,
              orderNumber: order.order_number,
              url: new URL("/cart", getServerEnv().APP_URL).toString(),
            },
          },
          { tx },
        )
      }
      return true
    })
    if (done) expired += 1
  }
  return { expired, confirmed }
}

/**
 * payments.reconcile job: picks up payments the customer completed but whose
 * callback and webhook never arrived (closed tab, network trouble).
 */
export async function reconcilePendingPayments(
  batchSize = 50,
): Promise<number> {
  const pending = await getDb().execute<{ id: string }>(sql`
    select distinct o.id from orders o join payments p on p.order_id = o.id
    where o.status = 'pending_payment' and p.status in ('created', 'failed', 'authorized')
      and p.created_at < now() - interval '2 minutes'
    limit ${batchSize}`)
  let settled = 0
  for (const { id } of pending.rows) {
    try {
      const paid = await capturedOnGateway(id)
      if (paid) {
        await settleCapturedPayment(
          paid.providerOrderId,
          paid.payment,
          "reconcile",
        )
        settled += 1
      }
    } catch (error) {
      logger.warn({ err: error, orderId: id }, "reconcile check failed")
    }
  }
  return settled
}

// --- Cancellation -------------------------------------------------------------------

/**
 * Cancels a confirmed order inside the caller's transaction (doc/03 §5):
 * restock, return the wallet part to the wallet, refund what was paid online
 * to its source, and give the coupon use back. The caller checks who may
 * cancel and that no parcel is with the courier.
 */
export async function cancelConfirmedOrder(
  tx: Transaction,
  order: OrderRow,
  actor: Actor,
  options: { by: "customer" | "staff"; reason?: string },
): Promise<{ refundPaise: number; walletPaise: number }> {
  const live = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from shipments where order_id = ${order.id} and status <> 'cancelled'`)
  const fulfillment = await tx.execute<{ fulfillment_status: string }>(
    sql`select fulfillment_status from orders where id = ${order.id}`,
  )
  if (
    !["confirmed", "processing"].includes(order.status) ||
    fulfillment.rows[0]!.fulfillment_status !== "unfulfilled" ||
    live.rows[0]!.n > 0
  ) {
    throw new DomainError(
      "INVALID_STATE",
      options.by === "customer"
        ? "This order can no longer be cancelled. Contact us if you need help."
        : "Cancel the parcel with the courier first; a parcel that has been picked up can't be cancelled.",
    )
  }
  await restockCommitted(tx, order.id, "cancel_restock")
  // The original debit, or the one taken again for a late payment.
  let walletBack = 0
  for (const key of [walletKey(order.id), `${walletKey(order.id)}:late`]) {
    walletBack += await reverseDebit(tx, {
      debitIdempotencyKey: key,
      reason: "cancellation_refund",
    })
  }
  await reverseCouponRedemption(tx, order.id)
  const captured = await tx.execute<{
    id: string
    amount_paise: number
    refunded_paise: number
  }>(sql`
    select p.id, p.amount_paise,
      p.refunded_paise + coalesce((select sum(r.amount_paise) from refunds r where r.payment_id = p.id and r.status = 'pending'), 0)::int as refunded_paise
    from payments p where p.order_id = ${order.id} and p.status in ('captured', 'partially_refunded')`)
  let onlineRefund = 0
  for (const payment of captured.rows) {
    const amount = payment.amount_paise - payment.refunded_paise
    const id = await requestRefund(tx, {
      paymentId: payment.id,
      orderId: order.id,
      amountPaise: amount,
      reason: `${options.by}_cancellation`,
      idempotencyKey: `cancel:${order.id}:${payment.id}`,
      initiatedBy: actor.kind === "user" ? actor.userId : null,
    })
    if (id) onlineRefund += amount
  }
  const reason = options.reason
    ? `${options.by}: ${options.reason}`
    : options.by
  await tx.execute(sql`
    update orders set status = 'cancelled', cancelled_at = now(),
      cancel_reason = ${reason},
      payment_status = case when ${onlineRefund} = 0 and payment_status <> 'unpaid' then 'refunded'::order_payment_status else payment_status end,
      updated_at = now()
    where id = ${order.id}`)
  await recordChange(tx, order.id, {
    field: "status",
    from: order.status,
    to: "cancelled",
    actor,
    reason: `${options.by}_cancellation`,
  })
  await emailCancellation(
    tx,
    order,
    options.by === "customer"
      ? "you cancelled it."
      : "we had to cancel it. We're sorry for the trouble.",
    onlineRefund + walletBack,
  )
  return { refundPaise: onlineRefund, walletPaise: walletBack }
}

/** Customer cancellation before dispatch (doc/03 §5). */
export const cancelOrder = defineOperation({
  name: "orders.cancel",
  access: "authenticated",
  input: z.object({
    orderNumber: z.string().regex(/^DUIS-\d{6,}$/),
    reason: z.string().trim().max(300).optional(),
  }),
  async handler({ actor }, { orderNumber, reason }) {
    if (actor.kind !== "user")
      throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
    return withTransaction(async (tx) => {
      const found = await tx.execute<{ id: string }>(sql`
        select id from orders where order_number = ${orderNumber} and user_id = ${actor.userId}`)
      if (!found.rows[0]) throw new DomainError("NOT_FOUND", "Order not found.")
      const order = await lockOrder(tx, found.rows[0].id)
      return cancelConfirmedOrder(tx, order, actor, { by: "customer", reason })
    })
  },
})

// When the gateway confirms a refund, update the order and tell the customer.
onRefundProcessed(async (tx, orderId, amountPaise) => {
  const order = await lockOrder(tx, orderId)
  const totals = await tx.execute<{ captured: number; refunded: number }>(sql`
    select coalesce(sum(amount_paise), 0)::int as captured, coalesce(sum(refunded_paise), 0)::int as refunded
    from payments where order_id = ${orderId} and status in ('captured', 'partially_refunded', 'refunded')`)
  const { captured, refunded } = totals.rows[0]!
  const next = refunded >= captured ? "refunded" : "partially_refunded"
  if (next !== order.payment_status) {
    await tx.execute(
      sql`update orders set payment_status = ${next}::order_payment_status, updated_at = now() where id = ${orderId}`,
    )
    await recordChange(tx, orderId, {
      field: "payment_status",
      from: order.payment_status,
      to: next,
      actor: systemActor("payments.refund"),
    })
  }
  if (deliverable(order.customer_email)) {
    await queueEmail(
      {
        template: "refund-issued",
        to: order.customer_email,
        userId: order.user_id,
        reference: { type: "order", id: orderId },
        props: {
          name: order.customer_name,
          orderNumber: order.order_number,
          url: orderUrl(order.order_number),
          amount: formatPaise(amountPaise),
        },
      },
      { tx },
    )
  }
})

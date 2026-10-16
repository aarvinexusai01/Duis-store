import "server-only"
import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"
import { logger } from "@/server/observability/logger"

import {
  getPaymentGateway,
  paymentGatewayFor,
  type GatewayPayment,
} from "./gateway"

/**
 * Payment rows and refunds. Order state changes live in the orders module;
 * this module only talks to the gateway and keeps its records.
 */

export type PaymentRow = {
  id: string
  order_id: string
  purpose: "full" | "advance" | "exchange_difference"
  provider: string
  provider_order_id: string
  provider_payment_id: string | null
  amount_paise: number
  refunded_paise: number
  status:
    | "created"
    | "authorized"
    | "captured"
    | "failed"
    | "refunded"
    | "partially_refunded"
}

const PAYMENT_COLUMNS = sql`id, order_id, purpose, provider, provider_order_id, provider_payment_id,
  amount_paise, refunded_paise, status`

/**
 * The gateway order the customer pays into. A retry after a failed attempt
 * reuses it (Razorpay accepts further attempts on the same order).
 */
export async function ensureGatewayOrder(input: {
  orderId: string
  orderNumber: string
  amountPaise: number
  purpose: "full" | "advance" | "exchange_difference"
}): Promise<{
  providerOrderId: string
  amountPaise: number
  provider: string
  publicKey: string
}> {
  const gateway = getPaymentGateway()
  const existing = await getDb().execute<PaymentRow>(sql`
    select ${PAYMENT_COLUMNS} from payments
    where order_id = ${input.orderId} and purpose = ${input.purpose}
      and provider = ${gateway.name} and status in ('created', 'failed')
      and amount_paise = ${input.amountPaise}
    order by created_at desc limit 1`)
  const row = existing.rows[0]
  if (row) {
    return {
      providerOrderId: row.provider_order_id,
      amountPaise: row.amount_paise,
      provider: gateway.name,
      publicKey: gateway.publicKey,
    }
  }
  const order = await gateway.createOrder({
    amountPaise: input.amountPaise,
    receipt: input.orderNumber,
    notes: { order_id: input.orderId, order_number: input.orderNumber },
  })
  if (order.amountPaise !== input.amountPaise || order.currency !== "INR") {
    throw new Error("gateway order amount mismatch")
  }
  await getDb().execute(sql`
    insert into payments (order_id, purpose, provider, provider_order_id, amount_paise)
    values (${input.orderId}, ${input.purpose}, ${gateway.name}, ${order.id}, ${input.amountPaise})`)
  return {
    providerOrderId: order.id,
    amountPaise: order.amountPaise,
    provider: gateway.name,
    publicKey: gateway.publicKey,
  }
}

/** Locks the payment row for a gateway order. */
export async function lockPaymentByProviderOrder(
  tx: Transaction,
  providerOrderId: string,
): Promise<PaymentRow | null> {
  const result = await tx.execute<PaymentRow>(sql`
    select ${PAYMENT_COLUMNS} from payments where provider_order_id = ${providerOrderId} for update`)
  return result.rows[0] ?? null
}

/** Records a captured payment on its row (inside the confirmation transaction). */
export async function markCaptured(
  tx: Transaction,
  row: PaymentRow,
  payment: GatewayPayment,
): Promise<void> {
  if (payment.amountPaise !== row.amount_paise || payment.currency !== "INR") {
    throw new DomainError(
      "CONFLICT",
      "Payment amount does not match the order.",
      {
        expected: row.amount_paise,
        received: payment.amountPaise,
      },
    )
  }
  await tx.execute(sql`
    update payments set status = 'captured', provider_payment_id = ${payment.id},
      method = ${payment.method}, captured_at = coalesce(captured_at, now()),
      error_code = null, error_reason = null, raw = ${JSON.stringify(payment)}::jsonb, updated_at = now()
    where id = ${row.id} and status in ('created', 'authorized', 'failed', 'captured')`)
}

/** A failed attempt; ignored once the payment is captured (out-of-order events). */
export async function markAttemptFailed(
  providerOrderId: string,
  payment: GatewayPayment,
): Promise<void> {
  await getDb().execute(sql`
    update payments set status = 'failed', provider_payment_id = coalesce(provider_payment_id, ${payment.id}),
      error_code = ${payment.errorCode}, error_reason = ${payment.errorReason},
      raw = ${JSON.stringify(payment)}::jsonb, updated_at = now()
    where provider_order_id = ${providerOrderId} and status in ('created', 'failed')`)
}

/** Captures an authorized payment (when auto-capture is off), else returns it as is. */
export async function captureIfAuthorized(
  payment: GatewayPayment,
): Promise<GatewayPayment> {
  if (payment.status !== "authorized") return payment
  return getPaymentGateway().capture(payment.id, payment.amountPaise)
}

/**
 * Records a refund to be sent to the gateway by the payments.refund job.
 * The idempotency key makes a repeated request (or job retry) a no-op.
 */
export async function requestRefund(
  tx: Transaction,
  input: {
    paymentId: string
    orderId: string
    amountPaise: number
    reason: string
    idempotencyKey: string
    initiatedBy?: string | null
  },
): Promise<string | null> {
  if (input.amountPaise <= 0) return null
  const locked = await tx.execute<{
    amount_paise: number
    refunded_paise: number
    pending: number
  }>(sql`
    select p.amount_paise, p.refunded_paise,
           coalesce((select sum(amount_paise) from refunds r where r.payment_id = p.id and r.status = 'pending'), 0)::int as pending
    from payments p where p.id = ${input.paymentId} for update`)
  const row = locked.rows[0]
  if (!row) throw new Error("payment not found for refund")
  // Total refunded per payment never exceeds what was captured (doc/05 §7).
  if (row.refunded_paise + row.pending + input.amountPaise > row.amount_paise) {
    throw new DomainError("CONFLICT", "This payment has already been refunded.")
  }
  const created = await tx.execute<{ id: string }>(sql`
    insert into refunds (payment_id, order_id, amount_paise, reason, idempotency_key, initiated_by)
    values (${input.paymentId}, ${input.orderId}, ${input.amountPaise}, ${input.reason}, ${input.idempotencyKey}, ${input.initiatedBy ?? null})
    on conflict (idempotency_key) do nothing
    returning id`)
  const id = created.rows[0]?.id
  if (id) await enqueue(QUEUES.issueRefund, { refundId: id }, { tx })
  return id ?? null
}

/**
 * payments.refund job: sends the refund once. Before calling the gateway it
 * checks for a refund already made with this receipt, so a crash between the
 * gateway call and the database update never refunds twice.
 */
export async function processRefund(
  refundId: string,
): Promise<"processed" | "pending" | "skipped"> {
  const loaded = await getDb().execute<{
    id: string
    status: string
    amount_paise: number
    idempotency_key: string
    provider_payment_id: string | null
    provider_refund_id: string | null
    provider: string
  }>(sql`
    select r.id, r.status, r.amount_paise, r.idempotency_key, r.provider_refund_id, p.provider_payment_id, p.provider
    from refunds r join payments p on p.id = r.payment_id where r.id = ${refundId}`)
  const refund = loaded.rows[0]
  if (!refund || refund.status !== "pending" || refund.provider_refund_id)
    return "skipped"
  if (!refund.provider_payment_id)
    throw new Error(`refund ${refundId}: payment has no gateway payment id`)

  // Refund through the gateway that took the payment.
  const gateway = paymentGatewayFor(refund.provider)
  if (!gateway) {
    throw new Error(
      `refund ${refundId}: the ${refund.provider} gateway isn't available here`,
    )
  }
  // Razorpay limits receipts to 40 characters.
  const receipt = refund.idempotency_key.slice(0, 40)
  const previous = (
    await gateway.fetchRefunds(refund.provider_payment_id)
  ).find((r) => r.receipt === receipt)
  const result =
    previous ??
    (await gateway.refund({
      paymentId: refund.provider_payment_id,
      amountPaise: refund.amount_paise,
      receipt,
    }))
  await applyRefundResult(refundId, result.id, result.status)
  logger.info({ refundId, status: result.status }, "refund sent to the gateway")
  return result.status === "processed" ? "processed" : "pending"
}

/** Records the gateway's answer (from the job or a refund webhook). Idempotent. */
export async function applyRefundResult(
  refundId: string | null,
  providerRefundId: string,
  status: "pending" | "processed" | "failed",
): Promise<void> {
  await withTransaction(async (tx) => {
    const updated = await tx.execute<{
      payment_id: string
      order_id: string
      amount_paise: number
      was: string
    }>(sql`
      update refunds r set provider_refund_id = ${providerRefundId},
        status = case when r.status = 'processed' then r.status else ${status}::refund_status end,
        updated_at = now()
      from (select id, status as was from refunds
            where ${refundId ? sql`id = ${refundId}` : sql`provider_refund_id = ${providerRefundId}`}
            for update) old
      where r.id = old.id
      returning r.payment_id, r.order_id, r.amount_paise, old.was`)
    const row = updated.rows[0]
    if (!row || status !== "processed" || row.was === "processed") return
    await tx.execute(sql`
      update payments set refunded_paise = refunded_paise + ${row.amount_paise},
        status = case when refunded_paise + ${row.amount_paise} >= amount_paise then 'refunded'::payment_status
                      else 'partially_refunded'::payment_status end,
        updated_at = now()
      where id = ${row.payment_id}`)
    await enqueueRefundNotice(tx, row.order_id, row.amount_paise)
  })
}

// Set by the orders module (it owns customer emails and order status).
let refundListener:
  | ((tx: Transaction, orderId: string, amountPaise: number) => Promise<void>)
  | null = null
export function onRefundProcessed(listener: typeof refundListener) {
  refundListener = listener
}
async function enqueueRefundNotice(
  tx: Transaction,
  orderId: string,
  amountPaise: number,
) {
  await refundListener?.(tx, orderId, amountPaise)
}

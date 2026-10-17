import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { marketingContextSchema } from "@/features/analytics"
import { redeemCoupon } from "@/features/discounts"
import { reserveStock } from "@/features/inventory"
import {
  confirmWalletPaidOrder,
  recordChange,
  settleCapturedPayment,
  walletKey,
} from "@/features/orders"
import {
  ensureGatewayOrder,
  getPaymentGateway,
  markAttemptFailed,
  simulateFakePayment,
} from "@/features/payments"
import { debitWallet } from "@/features/wallet"
import { getServerEnv } from "@/config/env"
import type { Actor, UserActor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { buildCheckoutContext, type CheckoutContext } from "./context"

/**
 * Checkout (doc/03 §3–4): quote, place, pay, verify. Amounts always come
 * from the server's own quote; the client's copy is only compared by hash.
 */

function userOf(actor: Actor): UserActor {
  if (actor.kind !== "user")
    throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
  return actor
}

const choicesSchema = z.object({
  addressId: z.uuid(),
  paymentMode: z.enum(["prepaid", "partial_cod"]),
  useWallet: z.boolean().default(false),
  couponCode: z.string().trim().max(32).optional().nullable(),
})

export type CheckoutView = Pick<
  CheckoutContext,
  | "quote"
  | "hash"
  | "address"
  | "couponError"
  | "walletBalancePaise"
  | "codAvailable"
  | "codReason"
> & { reservationMinutes: number }

function view(ctx: CheckoutContext): CheckoutView {
  return {
    quote: ctx.quote,
    hash: ctx.hash,
    address: ctx.address,
    couponError: ctx.couponError,
    walletBalancePaise: ctx.walletBalancePaise,
    codAvailable: ctx.codAvailable,
    codReason: ctx.codReason,
    reservationMinutes: ctx.settings.reservationTtlMinutes,
  }
}

export const getCheckoutQuote = defineOperation({
  name: "checkout.quote",
  access: "authenticated",
  input: choicesSchema,
  async handler({ actor }, choices): Promise<CheckoutView> {
    return view(await buildCheckoutContext(userOf(actor), choices))
  },
})

export type PaymentOptions = {
  provider: "razorpay" | "fake"
  key: string
  providerOrderId: string
  amountPaise: number
  currency: "INR"
  orderNumber: string
  prefill: { name: string; email?: string; contact?: string }
}

export type PlaceResult =
  | { status: "pay"; orderNumber: string; payment: PaymentOptions }
  | { status: "confirmed"; orderNumber: string }

async function paymentOptions(orderId: string): Promise<PaymentOptions> {
  const result = await getDb().execute<{
    order_number: string
    status: string
    payment_mode: "prepaid" | "partial_cod"
    online_amount_paise: number
    reservation_expires_at: Date | null
    customer_name: string
    customer_email: string | null
    customer_phone: string | null
  }>(sql`
    select order_number, status, payment_mode, online_amount_paise, reservation_expires_at,
           customer_name, customer_email, customer_phone
    from orders where id = ${orderId}`)
  const order = result.rows[0]!
  if (order.status !== "pending_payment") {
    throw new DomainError(
      "INVALID_STATE",
      "This order is no longer waiting for payment.",
    )
  }
  if (
    !order.reservation_expires_at ||
    new Date(order.reservation_expires_at).getTime() <= Date.now()
  ) {
    throw new DomainError(
      "INVALID_STATE",
      "The time to pay for this order has run out. Please place it again.",
    )
  }
  const gatewayOrder = await ensureGatewayOrder({
    orderId,
    orderNumber: order.order_number,
    amountPaise: order.online_amount_paise,
    purpose: order.payment_mode === "partial_cod" ? "advance" : "full",
  })
  return {
    provider: gatewayOrder.provider as PaymentOptions["provider"],
    key: gatewayOrder.publicKey,
    providerOrderId: gatewayOrder.providerOrderId,
    amountPaise: gatewayOrder.amountPaise,
    currency: "INR",
    orderNumber: order.order_number,
    prefill: {
      name: order.customer_name,
      ...(order.customer_email && !order.customer_email.endsWith(".invalid")
        ? { email: order.customer_email }
        : {}),
      ...(order.customer_phone ? { contact: order.customer_phone } : {}),
    },
  }
}

async function existingOrder(
  key: string,
  userId: string,
): Promise<PlaceResult | null> {
  const found = await getDb().execute<{
    id: string
    order_number: string
    user_id: string
    status: string
  }>(sql`
    select id, order_number, user_id, status from orders where place_idempotency_key = ${key}`)
  const order = found.rows[0]
  if (!order) return null
  if (order.user_id !== userId)
    throw new DomainError("CONFLICT", "Please refresh and try again.")
  if (order.status === "pending_payment") {
    return {
      status: "pay",
      orderNumber: order.order_number,
      payment: await paymentOptions(order.id),
    }
  }
  return { status: "confirmed", orderNumber: order.order_number }
}

/**
 * Places the order in one transaction (doc/03 §3): order, items, discounts,
 * stock reservation, wallet debit and coupon redemption all happen or none
 * do. The idempotency key makes a double-click or a retried request return
 * the same order.
 */
export const placeOrder = defineOperation({
  name: "checkout.placeOrder",
  access: "authenticated",
  input: choicesSchema.extend({
    quoteHash: z.string().regex(/^[0-9a-f]{32}$/),
    idempotencyKey: z.uuid(),
    // Only with marketing consent (ADR-0027); read by the action.
    marketingContext: marketingContextSchema.nullable().default(null),
  }),
  async handler({ actor, log }, input): Promise<PlaceResult> {
    const user = userOf(actor)
    const key = `place:${user.userId}:${input.idempotencyKey}`
    const repeated = await existingOrder(key, user.userId)
    if (repeated) return repeated

    const ctx = await buildCheckoutContext(user, input)
    const blocking = ctx.quote.issues.filter((i) => i.blocking)
    if (blocking.length > 0) {
      // Another checkout may have taken the last unit since the quote: report
      // it the same way as a failed reservation.
      const issue = blocking[0]!
      throw new DomainError(
        issue.code === "UNAVAILABLE" ? "OUT_OF_STOCK" : "CONFLICT",
        issue.message,
        { quote: view(ctx) },
      )
    }
    // The customer must have seen exactly these amounts.
    if (ctx.hash !== input.quoteHash) {
      throw new DomainError(
        "CONFLICT",
        "Your order total has changed. Please review it before paying.",
        {
          quote: view(ctx),
        },
      )
    }
    const q = ctx.quote

    let orderId: string
    try {
      orderId = await withTransaction(async (tx) => {
        const inserted = await tx.execute<{ id: string }>(sql`
          insert into orders (user_id, payment_mode, destination_country, is_export,
            subtotal_paise, discount_paise, shipping_fee_paise, cod_fee_paise, tax_total_paise, total_paise,
            wallet_applied_paise, online_amount_paise, cod_due_paise,
            fee_tax_rate_bp, fee_taxable_paise, fee_cgst_paise, fee_sgst_paise, fee_igst_paise,
            coupon_code, shipping_address, customer_name, customer_email, customer_phone,
            place_idempotency_key, quote, quote_hash, reservation_expires_at, marketing_context)
          values (${user.userId}, ${q.paymentMode}, ${ctx.address.countryCode}, ${q.isExport},
            ${q.subtotalPaise}, ${q.discountPaise}, ${q.shippingFeePaise}, ${q.codFeePaise}, ${q.taxTotalPaise}, ${q.totalPaise},
            ${q.walletAppliedPaise}, ${q.onlineAmountPaise}, ${q.codDuePaise},
            ${q.fees.taxRateBp}, ${q.fees.taxablePaise}, ${q.fees.cgstPaise}, ${q.fees.sgstPaise}, ${q.fees.igstPaise},
            ${q.couponCode}, ${JSON.stringify(ctx.address)}::jsonb, ${ctx.address.fullName},
            ${ctx.customer.email}, ${ctx.address.phone},
            ${key}, ${JSON.stringify(q)}::jsonb, ${ctx.hash},
            now() + make_interval(mins => ${ctx.settings.reservationTtlMinutes}),
            ${input.marketingContext ? JSON.stringify(input.marketingContext) : null}::jsonb)
          returning id`)
        const id = inserted.rows[0]!.id
        for (const line of q.lines) {
          await tx.execute(sql`
            insert into order_items (order_id, position, variant_id, product_id, sku, title, variant_label, image_key,
              hsn_code, unit_price_paise, unit_mrp_paise, quantity, discount_paise, line_total_paise,
              tax_rate_bp, taxable_paise, cgst_paise, sgst_paise, igst_paise)
            values (${id}, ${line.position}, ${line.variantId}, ${line.productId}, ${line.sku}, ${line.title},
              ${line.variantLabel}, ${line.imageKey}, ${line.hsnCode}, ${line.unitPricePaise}, ${line.unitMrpPaise},
              ${line.quantity}, ${line.discountPaise}, ${line.lineTotalPaise}, ${line.taxRateBp}, ${line.taxablePaise},
              ${line.cgstPaise}, ${line.sgstPaise}, ${line.igstPaise})`)
        }
        for (const discount of q.discounts) {
          await tx.execute(sql`
            insert into order_discounts (order_id, discount_id, coupon_id, label, amount_paise, allocation)
            values (${id}, ${discount.discountId}, ${discount.couponId}, ${discount.label},
                    ${discount.amountPaise}, ${JSON.stringify(discount.allocation)}::jsonb)`)
        }
        await reserveStock(
          tx,
          { orderId: id },
          q.lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
          })),
          ctx.settings.reservationTtlMinutes,
        )
        if (q.walletAppliedPaise > 0) {
          await debitWallet(tx, {
            userId: user.userId,
            amountPaise: q.walletAppliedPaise,
            reference: { type: "order", id },
            idempotencyKey: walletKey(id),
          })
        }
        const couponLine = q.discounts.find((d) => d.couponId)
        if (couponLine?.couponId) {
          await redeemCoupon(tx, {
            couponId: couponLine.couponId,
            orderId: id,
            userId: user.userId,
            amountPaise: couponLine.amountPaise,
          })
        }
        await recordChange(tx, id, {
          field: "status",
          from: null,
          to: "pending_payment",
          actor,
        })
        return id
      })
    } catch (error) {
      // A concurrent identical request won the race: return its order.
      if (isUniqueViolation(error)) {
        const order = await existingOrder(key, user.userId)
        if (order) return order
      }
      throw error
    }

    const orderNumber = (
      await getDb().execute<{ order_number: string }>(
        sql`select order_number from orders where id = ${orderId}`,
      )
    ).rows[0]!.order_number
    log.info(
      { orderNumber, total: q.totalPaise, mode: q.paymentMode },
      "order placed",
    )

    if (q.onlineAmountPaise === 0) {
      await confirmWalletPaidOrder(orderId, actor)
      return { status: "confirmed", orderNumber }
    }
    return {
      status: "pay",
      orderNumber,
      payment: await paymentOptions(orderId),
    }
  },
})

async function ownOrder(
  user: UserActor,
  orderNumber: string,
): Promise<{ id: string; status: string }> {
  const found = await getDb().execute<{ id: string; status: string }>(sql`
    select id, status from orders where order_number = ${orderNumber} and user_id = ${user.userId}`)
  const order = found.rows[0]
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.")
  return order
}

const orderNumberSchema = z.string().regex(/^DUIS-\d{6,}$/)

/** Payment options again, for a retry after a failed or abandoned attempt. */
export const startPayment = defineOperation({
  name: "checkout.startPayment",
  access: "authenticated",
  input: z.object({ orderNumber: orderNumberSchema }),
  async handler({ actor }, { orderNumber }): Promise<PaymentOptions> {
    const order = await ownOrder(userOf(actor), orderNumber)
    return paymentOptions(order.id)
  },
})

/**
 * The browser callback after checkout (doc/03 §3): verify the signature,
 * then fetch the payment from the gateway and check it ourselves before
 * confirming. The webhook reaches the same outcome independently.
 */
export const verifyPayment = defineOperation({
  name: "checkout.verifyPayment",
  access: "authenticated",
  input: z.object({
    orderNumber: orderNumberSchema,
    providerOrderId: z.string().min(5).max(64),
    providerPaymentId: z.string().min(5).max(64),
    signature: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  async handler(
    { actor, log },
    input,
  ): Promise<{ status: "confirmed" | "pending" | "failed" | "cancelled" }> {
    const order = await ownOrder(userOf(actor), input.orderNumber)
    const gateway = getPaymentGateway()
    if (
      !gateway.verifyCheckoutSignature(
        input.providerOrderId,
        input.providerPaymentId,
        input.signature,
      )
    ) {
      log.warn({ orderNumber: input.orderNumber }, "payment signature mismatch")
      throw new DomainError("FORBIDDEN", "We couldn't verify this payment.")
    }
    const belongs = await getDb().execute<{ id: string }>(sql`
      select id from payments where provider_order_id = ${input.providerOrderId} and order_id = ${order.id}`)
    if (!belongs.rows[0])
      throw new DomainError("FORBIDDEN", "We couldn't verify this payment.")

    const payment = await gateway.fetchPayment(input.providerPaymentId)
    if (payment.orderId !== input.providerOrderId) {
      throw new DomainError("FORBIDDEN", "We couldn't verify this payment.")
    }
    if (payment.status === "failed") {
      await markAttemptFailed(input.providerOrderId, payment)
      return { status: "failed" }
    }
    if (payment.status !== "captured" && payment.status !== "authorized")
      return { status: "pending" }
    const result = await settleCapturedPayment(
      input.providerOrderId,
      payment,
      "callback",
    )
    if (result === "refunded_late") return { status: "cancelled" }
    return { status: "confirmed" }
  },
})

/**
 * Fake gateway only (development and end-to-end tests): stands in for the
 * hosted checkout. Refused whenever the real gateway is configured.
 */
export const simulatePayment = defineOperation({
  name: "checkout.simulatePayment",
  access: "authenticated",
  input: z.object({
    orderNumber: orderNumberSchema,
    providerOrderId: z.string().startsWith("fake_order_"),
    outcome: z.enum(["captured", "failed"]),
  }),
  async handler({ actor }, input) {
    const env = getServerEnv()
    if (env.PAYMENT_PROVIDER !== "fake" || env.APP_ENV === "production") {
      throw new DomainError("FORBIDDEN", "Simulated payments are disabled.")
    }
    await ownOrder(userOf(actor), input.orderNumber)
    return simulateFakePayment(input.providerOrderId, input.outcome)
  },
})

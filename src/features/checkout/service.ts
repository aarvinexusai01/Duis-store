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
import { STORE_POLICY } from "@/config/store-policy"
import type { Currency } from "@/lib/fx"
import type { Actor, UserActor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { consentFields, recordConsents } from "@/server/privacy"
import {
  hitLimit,
  LIMITS,
  overLimit,
  rateLimited,
} from "@/server/security/shared-rate-limit"
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
    const user = userOf(actor)
    // Rate limits (doc/06 Phase 8 audit): quotes are database-heavy, and
    // failed coupon codes are how codes get guessed.
    if (!(await hitLimit(`quote:${user.userId}`, LIMITS.checkoutQuote))) {
      throw rateLimited(
        "You're updating checkout very quickly. Please wait a moment.",
      )
    }
    const couponFailures = `coupon-fail:${user.userId}`
    if (
      choices.couponCode &&
      (await overLimit(couponFailures, LIMITS.couponFailures))
    ) {
      throw rateLimited(
        "Too many coupon codes tried. Please wait a minute and try again.",
      )
    }
    const ctx = await buildCheckoutContext(user, choices)
    if (choices.couponCode && ctx.couponError) {
      await hitLimit(couponFailures, LIMITS.couponFailures)
    }
    return view(ctx)
  },
})

export type PaymentOptions = {
  provider: "razorpay" | "fake"
  key: string
  providerOrderId: string
  /** In minor units of `currency`: paise, or cents for USD. */
  amountMinor: number
  currency: Currency
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
    currency: Currency
    online_amount: number
    reservation_expires_at: Date | null
    customer_name: string
    customer_email: string | null
    customer_phone: string | null
  }>(sql`
    select order_number, status, payment_mode, currency,
           coalesce(online_amount_minor, online_amount_paise) as online_amount, reservation_expires_at,
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
    amountPaise: order.online_amount,
    currency: order.currency,
    purpose: order.payment_mode === "partial_cod" ? "advance" : "full",
  })
  return {
    provider: gatewayOrder.provider as PaymentOptions["provider"],
    key: gatewayOrder.publicKey,
    providerOrderId: gatewayOrder.providerOrderId,
    amountMinor: gatewayOrder.amountPaise,
    currency: order.currency,
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
    // DPDP: the order's data notice, ticked (doc/06 Phase 12).
    ...consentFields,
  }),
  async handler({ actor, log }, input): Promise<PlaceResult> {
    const user = userOf(actor)
    const key = `place:${user.userId}:${input.idempotencyKey}`
    const repeated = await existingOrder(key, user.userId)
    if (repeated) return repeated
    if (!(await hitLimit(`place:${user.userId}`, LIMITS.placeOrder))) {
      throw rateLimited(
        "Too many checkout attempts. Please wait a few minutes and try again.",
      )
    }

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
      // Most often because their coupon was used up a moment ago (race test
      // M1): say so, rather than only that the total changed.
      const reason =
        input.couponCode && ctx.couponError
          ? `${ctx.couponError} Your total has been updated; please review it before paying.`
          : "Your order total has changed. Please review it before paying."
      throw new DomainError("CONFLICT", reason, {
        quote: view(ctx),
      })
    }
    const q = ctx.quote
    // What the books record (doc/06 Phase 13): the quote itself for rupees;
    // for dollars, the rupee equivalent, with the charged cents beside it.
    const usd = ctx.ledger && q.fx ? { ledger: ctx.ledger, fx: q.fx } : null
    const books = usd
      ? {
          subtotal: usd.ledger.subtotalPaise,
          discount: usd.ledger.discountPaise,
          shipping: usd.ledger.shippingFeePaise,
          cod: 0,
          tax: 0,
          total: usd.ledger.totalPaise,
          wallet: 0,
          online: usd.ledger.totalPaise,
          codDue: 0,
          fees: {
            taxRateBp: 0,
            taxablePaise: usd.ledger.shippingFeePaise,
            cgstPaise: 0,
            sgstPaise: 0,
            igstPaise: 0,
          },
        }
      : {
          subtotal: q.subtotalPaise,
          discount: q.discountPaise,
          shipping: q.shippingFeePaise,
          cod: q.codFeePaise,
          tax: q.taxTotalPaise,
          total: q.totalPaise,
          wallet: q.walletAppliedPaise,
          online: q.onlineAmountPaise,
          codDue: q.codDuePaise,
          fees: q.fees,
        }

    let orderId: string
    try {
      orderId = await withTransaction(async (tx) => {
        // Unpaid orders hold stock, so one customer may only have a few at
        // once; otherwise one account could make an item look sold out. The
        // customer's row is locked so two checkouts at once count each other.
        await tx.execute(
          sql`select id from users where id = ${user.userId} for no key update`,
        )
        const open = await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from orders
          where user_id = ${user.userId} and status = 'pending_payment'
            and reservation_expires_at > now()`)
        if (open.rows[0]!.n >= STORE_POLICY.maxOpenUnpaidOrders) {
          throw new DomainError(
            "CONFLICT",
            `You already have ${STORE_POLICY.maxOpenUnpaidOrders} unpaid orders. Pay for one of them in My orders, or wait up to 15 minutes for it to lapse, then try again.`,
          )
        }
        const inserted = await tx.execute<{ id: string }>(sql`
          insert into orders (user_id, payment_mode, destination_country, is_export,
            subtotal_paise, discount_paise, shipping_fee_paise, cod_fee_paise, tax_total_paise, total_paise,
            wallet_applied_paise, online_amount_paise, cod_due_paise,
            fee_tax_rate_bp, fee_taxable_paise, fee_cgst_paise, fee_sgst_paise, fee_igst_paise,
            coupon_code, shipping_address, customer_name, customer_email, customer_phone,
            place_idempotency_key, quote, quote_hash, reservation_expires_at, marketing_context,
            currency, fx_rate_micros, fx_source, fx_as_of, price_uplift_bp,
            subtotal_minor, discount_minor, shipping_fee_minor, total_minor, online_amount_minor)
          values (${user.userId}, ${q.paymentMode}, ${ctx.address.countryCode}, ${q.isExport},
            ${books.subtotal}, ${books.discount}, ${books.shipping}, ${books.cod}, ${books.tax}, ${books.total},
            ${books.wallet}, ${books.online}, ${books.codDue},
            ${books.fees.taxRateBp}, ${books.fees.taxablePaise}, ${books.fees.cgstPaise}, ${books.fees.sgstPaise}, ${books.fees.igstPaise},
            ${q.couponCode}, ${JSON.stringify(ctx.address)}::jsonb, ${ctx.address.fullName},
            ${ctx.customer.email}, ${ctx.address.phone},
            ${key}, ${JSON.stringify(q)}::jsonb, ${ctx.hash},
            now() + make_interval(mins => ${ctx.settings.reservationTtlMinutes}),
            ${input.marketingContext ? JSON.stringify(input.marketingContext) : null}::jsonb,
            ${q.currency}, ${usd?.fx.rateMicros ?? null}, ${usd?.fx.source ?? null}, ${usd?.fx.asOf ?? null},
            ${usd?.fx.upliftBp ?? null},
            ${usd ? q.subtotalPaise : null}, ${usd ? q.discountPaise : null}, ${usd ? q.shippingFeePaise : null},
            ${usd ? q.totalPaise : null}, ${usd ? q.onlineAmountPaise : null})
          returning id`)
        const id = inserted.rows[0]!.id
        await recordConsents(tx, {
          userId: user.userId,
          purposes: ["order"],
          source: "checkout",
          language: input.consentLanguage,
          reference: { type: "order", id },
        })
        for (const [i, line] of q.lines.entries()) {
          // Dollar lines go in the books in rupees (no GST on exports).
          const inr = usd
            ? {
                ...usd.ledger.lines[i]!,
                taxRateBp: 0,
                taxablePaise: usd.ledger.lines[i]!.lineTotalPaise,
                cgstPaise: 0,
                sgstPaise: 0,
                igstPaise: 0,
              }
            : line
          await tx.execute(sql`
            insert into order_items (order_id, position, variant_id, product_id, sku, title, variant_label, image_key,
              hsn_code, unit_price_paise, unit_mrp_paise, quantity, discount_paise, line_total_paise,
              tax_rate_bp, taxable_paise, cgst_paise, sgst_paise, igst_paise,
              unit_price_minor, unit_mrp_minor, discount_minor, line_total_minor)
            values (${id}, ${line.position}, ${line.variantId}, ${line.productId}, ${line.sku}, ${line.title},
              ${line.variantLabel}, ${line.imageKey}, ${line.hsnCode}, ${inr.unitPricePaise}, ${inr.unitMrpPaise},
              ${line.quantity}, ${inr.discountPaise}, ${inr.lineTotalPaise}, ${inr.taxRateBp}, ${inr.taxablePaise},
              ${inr.cgstPaise}, ${inr.sgstPaise}, ${inr.igstPaise},
              ${usd ? line.unitPricePaise : null}, ${usd ? line.unitMrpPaise : null},
              ${usd ? line.discountPaise : null}, ${usd ? line.lineTotalPaise : null})`)
        }
        for (const [i, discount] of q.discounts.entries()) {
          const inr = usd ? usd.ledger.discounts[i]! : discount
          await tx.execute(sql`
            insert into order_discounts (order_id, discount_id, coupon_id, label, amount_paise, allocation, amount_minor)
            values (${id}, ${discount.discountId}, ${discount.couponId}, ${discount.label},
                    ${inr.amountPaise}, ${JSON.stringify(inr.allocation)}::jsonb,
                    ${usd ? discount.amountPaise : null})`)
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
        const couponIndex = q.discounts.findIndex((d) => d.couponId)
        const couponLine = q.discounts[couponIndex]
        if (couponLine?.couponId) {
          await redeemCoupon(tx, {
            couponId: couponLine.couponId,
            orderId: id,
            userId: user.userId,
            // Coupon reports stay in rupees.
            amountPaise: usd
              ? usd.ledger.discounts[couponIndex]!.amountPaise
              : couponLine.amountPaise,
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
      {
        orderNumber,
        total: q.totalPaise,
        currency: q.currency,
        mode: q.paymentMode,
      },
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

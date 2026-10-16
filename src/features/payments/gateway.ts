import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

import { getServerEnv } from "@/config/env"

/**
 * The payment gateway boundary (doc/02 §6). Razorpay is called over its REST
 * API with the key pair; the fake gateway simulates the same contract for
 * development and tests and is refused in production by env validation.
 */

export type GatewayOrder = { id: string; amountPaise: number; currency: string }

export type GatewayPayment = {
  id: string
  orderId: string
  status: "created" | "authorized" | "captured" | "failed" | "refunded"
  amountPaise: number
  currency: string
  method: string | null
  errorCode: string | null
  errorReason: string | null
}

export type RecordedRefund = {
  id: string
  status: "pending" | "processed" | "failed"
  receipt: string | null
  amountPaise: number
}

export type GatewayRefund = {
  id: string
  status: "pending" | "processed" | "failed"
}

export interface PaymentGateway {
  readonly name: "razorpay" | "fake"
  /** Public key for the browser checkout. */
  readonly publicKey: string
  createOrder(input: {
    amountPaise: number
    receipt: string
    notes: Record<string, string>
  }): Promise<GatewayOrder>
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>
  fetchPayment(paymentId: string): Promise<GatewayPayment>
  capture(paymentId: string, amountPaise: number): Promise<GatewayPayment>
  refund(input: {
    paymentId: string
    amountPaise: number
    receipt: string
  }): Promise<GatewayRefund>
  /** Refunds already made on a payment, so a retried refund is never sent twice. */
  fetchRefunds(paymentId: string): Promise<RecordedRefund[]>
  /** HMAC(order_id|payment_id) from the browser callback. */
  verifyCheckoutSignature(
    orderId: string,
    paymentId: string,
    signature: string,
  ): boolean
  /** HMAC(raw body) on webhooks. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean
  /** A cheap authenticated call, for the admin "test connection" button. */
  ping(): Promise<void>
}

export function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex")
}

export function safeEqualHex(expected: string, actual: string): boolean {
  if (!/^[0-9a-f]+$/i.test(actual) || actual.length !== expected.length)
    return false
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(actual, "hex"),
  )
}

// --- Razorpay ----------------------------------------------------------------------

type RazorpayPayment = {
  id: string
  order_id: string
  status: GatewayPayment["status"]
  amount: number
  currency: string
  method?: string
  error_code?: string | null
  error_description?: string | null
}

function toPayment(p: RazorpayPayment): GatewayPayment {
  return {
    id: p.id,
    orderId: p.order_id,
    status: p.status,
    amountPaise: p.amount,
    currency: p.currency,
    method: p.method ?? null,
    errorCode: p.error_code ?? null,
    errorReason: p.error_description ?? null,
  }
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "GatewayError"
  }
}

function razorpay(
  keyId: string,
  keySecret: string,
  webhookSecret: string,
): PaymentGateway {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`
  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await response.json().catch(() => null)) as
      (T & { error?: { description?: string } }) | null
    if (!response.ok || !data) {
      // Razorpay's description never contains secrets; the key never leaves here.
      throw new GatewayError(
        `Razorpay ${method} ${path.split("/")[1]} failed: ${data?.error?.description ?? response.status}`,
        response.status,
      )
    }
    return data
  }

  return {
    name: "razorpay",
    async ping() {
      await call("GET", "/orders?count=1")
    },
    publicKey: keyId,
    async createOrder({ amountPaise, receipt, notes }) {
      const order = await call<{
        id: string
        amount: number
        currency: string
      }>("POST", "/orders", {
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes,
      })
      return {
        id: order.id,
        amountPaise: order.amount,
        currency: order.currency,
      }
    },
    async fetchOrderPayments(orderId) {
      const result = await call<{ items: RazorpayPayment[] }>(
        "GET",
        `/orders/${encodeURIComponent(orderId)}/payments`,
      )
      return result.items.map(toPayment)
    },
    async fetchPayment(paymentId) {
      return toPayment(
        await call<RazorpayPayment>(
          "GET",
          `/payments/${encodeURIComponent(paymentId)}`,
        ),
      )
    },
    async capture(paymentId, amountPaise) {
      return toPayment(
        await call<RazorpayPayment>(
          "POST",
          `/payments/${encodeURIComponent(paymentId)}/capture`,
          {
            amount: amountPaise,
            currency: "INR",
          },
        ),
      )
    },
    async refund({ paymentId, amountPaise, receipt }) {
      const refund = await call<{
        id: string
        status: GatewayRefund["status"]
      }>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, {
        amount: amountPaise,
        speed: "normal",
        receipt,
      })
      return { id: refund.id, status: refund.status }
    },
    async fetchRefunds(paymentId) {
      const result = await call<{
        items: {
          id: string
          status: RecordedRefund["status"]
          receipt: string | null
          amount: number
        }[]
      }>("GET", `/payments/${encodeURIComponent(paymentId)}/refunds`)
      return result.items.map((r) => ({
        id: r.id,
        status: r.status,
        receipt: r.receipt,
        amountPaise: r.amount,
      }))
    },
    verifyCheckoutSignature(orderId, paymentId, signature) {
      return safeEqualHex(
        hmacHex(keySecret, `${orderId}|${paymentId}`),
        signature,
      )
    },
    verifyWebhookSignature(rawBody, signature) {
      return safeEqualHex(hmacHex(webhookSecret, rawBody), signature)
    },
  }
}

// --- Fake --------------------------------------------------------------------------

type FakeState = {
  orders: Map<string, GatewayOrder>
  payments: Map<string, GatewayPayment>
  refunds: Map<
    string,
    (GatewayRefund & { receipt: string | null; amountPaise: number })[]
  >
}
const globalForFake = globalThis as typeof globalThis & {
  __duisFakeGateway?: FakeState
}

/** Development/test secret for fake signatures; never used with real money. */
export const FAKE_GATEWAY_SECRET = "fake-gateway-secret-development-only"

function fakeState(): FakeState {
  return (globalForFake.__duisFakeGateway ??= {
    orders: new Map(),
    payments: new Map(),
    refunds: new Map(),
  })
}

const fake: PaymentGateway = {
  name: "fake",
  publicKey: "fake_key",
  async ping() {},
  async createOrder({ amountPaise }) {
    const order = {
      id: `fake_order_${crypto.randomUUID().replace(/-/g, "")}`,
      amountPaise,
      currency: "INR",
    }
    fakeState().orders.set(order.id, order)
    return order
  },
  async fetchOrderPayments(orderId) {
    return [...fakeState().payments.values()].filter(
      (p) => p.orderId === orderId,
    )
  },
  async fetchPayment(paymentId) {
    const payment = fakeState().payments.get(paymentId)
    if (!payment) throw new GatewayError("fake payment not found", 404)
    return payment
  },
  async capture(paymentId) {
    const payment = await this.fetchPayment(paymentId)
    payment.status = "captured"
    return payment
  },
  async refund({ paymentId, amountPaise, receipt }) {
    const refund: RecordedRefund = {
      id: `fake_rfnd_${crypto.randomUUID().replace(/-/g, "")}`,
      status: "processed",
      receipt,
      amountPaise,
    }
    const list = fakeState().refunds.get(paymentId) ?? []
    list.push(refund)
    fakeState().refunds.set(paymentId, list)
    return { id: refund.id, status: refund.status }
  },
  async fetchRefunds(paymentId) {
    return fakeState().refunds.get(paymentId) ?? []
  },
  verifyCheckoutSignature(orderId, paymentId, signature) {
    return safeEqualHex(
      hmacHex(FAKE_GATEWAY_SECRET, `${orderId}|${paymentId}`),
      signature,
    )
  },
  verifyWebhookSignature(rawBody, signature) {
    return safeEqualHex(hmacHex(FAKE_GATEWAY_SECRET, rawBody), signature)
  },
}

/**
 * Fake gateway only: records a payment attempt as the hosted checkout would,
 * and returns the callback fields (including a valid signature).
 */
export function simulateFakePayment(
  orderId: string,
  outcome: "captured" | "failed",
): { paymentId: string; signature: string } {
  const order = fakeState().orders.get(orderId)
  if (!order) throw new GatewayError("fake order not found", 404)
  const payment: GatewayPayment = {
    id: `fake_pay_${crypto.randomUUID().replace(/-/g, "")}`,
    orderId,
    status: outcome,
    amountPaise: order.amountPaise,
    currency: "INR",
    method: "upi",
    errorCode: outcome === "failed" ? "BAD_REQUEST_ERROR" : null,
    errorReason: outcome === "failed" ? "Payment declined (simulated)" : null,
  }
  fakeState().payments.set(payment.id, payment)
  return {
    paymentId: payment.id,
    signature: hmacHex(FAKE_GATEWAY_SECRET, `${orderId}|${payment.id}`),
  }
}

export function getPaymentGateway(): PaymentGateway {
  const env = getServerEnv()
  if (env.PAYMENT_PROVIDER === "razorpay") {
    return razorpay(
      env.RAZORPAY_KEY_ID!,
      env.RAZORPAY_KEY_SECRET!,
      env.RAZORPAY_WEBHOOK_SECRET!,
    )
  }
  return fake
}

/**
 * The gateway that took a stored payment, which may differ from today's
 * PAYMENT_PROVIDER (e.g. test orders paid with the fake gateway before
 * switching to Razorpay). Null when that gateway can't be used here: the
 * fake one never in production, Razorpay only with its keys.
 */
export function paymentGatewayFor(provider: string): PaymentGateway | null {
  const env = getServerEnv()
  if (provider === "razorpay") {
    return env.RAZORPAY_KEY_ID &&
      env.RAZORPAY_KEY_SECRET &&
      env.RAZORPAY_WEBHOOK_SECRET
      ? razorpay(
          env.RAZORPAY_KEY_ID,
          env.RAZORPAY_KEY_SECRET,
          env.RAZORPAY_WEBHOOK_SECRET,
        )
      : null
  }
  if (provider === "fake") return env.APP_ENV === "production" ? null : fake
  return null
}

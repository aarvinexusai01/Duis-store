"use server"

import { cookies, headers } from "next/headers"

import {
  CONSENT_COOKIE,
  marketingContextSchema,
  parseConsent,
} from "@/features/analytics"
import type { MarketingContext } from "@/db/schema"
import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import type { CheckoutChoices } from "./context"
import {
  getCheckoutQuote,
  placeOrder,
  simulatePayment,
  startPayment,
  verifyPayment,
  type CheckoutView,
  type PaymentOptions,
  type PlaceResult,
} from "./service"

type Result<T> =
  ({ ok: true } & T) | ({ ok: false; quote?: CheckoutView } & ActionError)

function failure(
  error: unknown,
): { ok: false; quote?: CheckoutView } & ActionError {
  const mapped = toActionError(error)
  const quote = (error as { details?: { quote?: CheckoutView } })?.details
    ?.quote
  return { ok: false, ...mapped, ...(quote ? { quote } : {}) }
}

/**
 * What the Conversions API will need once the order is paid, only when this
 * browser gave marketing consent (ADR-0027). Null: nothing goes to Meta
 * from the server for this order.
 */
async function readMarketingContext(): Promise<MarketingContext | null> {
  const jar = await cookies()
  if (!parseConsent(jar.get(CONSENT_COOKIE)?.value)?.marketing) return null
  const userAgent = (await headers()).get("user-agent")
  return marketingContextSchema.parse({
    fbp: jar.get("_fbp")?.value,
    fbc: jar.get("_fbc")?.value,
    userAgent: userAgent ? userAgent.slice(0, 500) : undefined,
  })
}

export async function quoteAction(
  choices: CheckoutChoices,
): Promise<Result<{ view: CheckoutView }>> {
  try {
    return { ok: true, view: await getCheckoutQuote(await getActor(), choices) }
  } catch (error) {
    return failure(error)
  }
}

export async function placeOrderAction(
  input: CheckoutChoices & { quoteHash: string; idempotencyKey: string },
): Promise<Result<{ result: PlaceResult }>> {
  try {
    return {
      ok: true,
      result: await placeOrder(await getActor(), {
        ...input,
        marketingContext: await readMarketingContext(),
      }),
    }
  } catch (error) {
    return failure(error)
  }
}

export async function startPaymentAction(
  orderNumber: string,
): Promise<Result<{ payment: PaymentOptions }>> {
  try {
    return {
      ok: true,
      payment: await startPayment(await getActor(), { orderNumber }),
    }
  } catch (error) {
    return failure(error)
  }
}

export async function verifyPaymentAction(input: {
  orderNumber: string
  providerOrderId: string
  providerPaymentId: string
  signature: string
}): Promise<
  Result<{ status: "confirmed" | "pending" | "failed" | "cancelled" }>
> {
  try {
    const { status } = await verifyPayment(await getActor(), input)
    return { ok: true, status }
  } catch (error) {
    return failure(error)
  }
}

/** Development and tests only (refused unless the fake gateway is active). */
export async function simulatePaymentAction(input: {
  orderNumber: string
  providerOrderId: string
  outcome: "captured" | "failed"
}): Promise<Result<{ paymentId: string; signature: string }>> {
  try {
    return { ok: true, ...(await simulatePayment(await getActor(), input)) }
  } catch (error) {
    return failure(error)
  }
}

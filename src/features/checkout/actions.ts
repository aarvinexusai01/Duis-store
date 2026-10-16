"use server"

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
    return { ok: true, result: await placeOrder(await getActor(), input) }
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

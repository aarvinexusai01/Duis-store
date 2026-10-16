"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import {
  approveExchange,
  failExchangeQc,
  markExchangeReceived,
  passExchangeQc,
  rejectExchange,
} from "./admin"
import {
  cancelMyExchange,
  requestExchange,
  startExchangePayment,
} from "./service"

type Result<T = object> = ({ ok: true } & T) | ({ ok: false } & ActionError)

async function run<T extends object>(
  work: () => Promise<T>,
): Promise<Result<T>> {
  try {
    const value = await work()
    refresh()
    return { ok: true, ...value }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

type Input<F extends (actor: never, input: never) => unknown> = Parameters<F>[1]

export async function requestExchangeAction(
  input: Input<typeof requestExchange>,
) {
  return run(async () => requestExchange(await getActor(), input))
}

export async function cancelExchangeAction(exchangeNumber: string) {
  return run(async () => cancelMyExchange(await getActor(), { exchangeNumber }))
}

export async function startExchangePaymentAction(exchangeNumber: string) {
  try {
    const payment = await startExchangePayment(await getActor(), {
      exchangeNumber,
    })
    return { ok: true as const, payment }
  } catch (error) {
    return { ok: false as const, ...toActionError(error) }
  }
}

// Staff
export async function approveExchangeAction(
  input: Input<typeof approveExchange>,
) {
  return run(async () => approveExchange(await getActor(), input))
}

export async function rejectExchangeAction(
  input: Input<typeof rejectExchange>,
) {
  return run(async () => rejectExchange(await getActor(), input))
}

export async function markExchangeReceivedAction(exchangeNumber: string) {
  return run(async () =>
    markExchangeReceived(await getActor(), { exchangeNumber }),
  )
}

export async function passExchangeQcAction(
  input: Input<typeof passExchangeQc>,
) {
  return run(async () => passExchangeQc(await getActor(), input))
}

export async function failExchangeQcAction(
  input: Input<typeof failExchangeQc>,
) {
  return run(async () => failExchangeQc(await getActor(), input))
}

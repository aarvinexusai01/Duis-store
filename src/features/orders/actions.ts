"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { cancelOrder } from "./lifecycle"

export async function cancelOrderAction(
  orderNumber: string,
  reason?: string,
): Promise<{ ok: true } | ({ ok: false } & ActionError)> {
  try {
    await cancelOrder(await getActor(), { orderNumber, reason })
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

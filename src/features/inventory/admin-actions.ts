"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { setCountedStock } from "./admin"
import { adjustStock, setLowStockThreshold } from "./service"

type Result = { ok: true } | ({ ok: false } & ActionError)

async function run(work: () => Promise<unknown>): Promise<Result> {
  try {
    await work()
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

export async function adjustStockAction(input: {
  variantId: string
  delta: number
  reason: "receive" | "adjust" | "damaged"
  note?: string
}) {
  return run(async () => adjustStock(await getActor(), input))
}

export async function setCountedStockAction(input: {
  variantId: string
  counted: number
  note?: string
}) {
  return run(async () => setCountedStock(await getActor(), input))
}

export async function setThresholdAction(input: {
  variantId: string
  threshold: number
}) {
  return run(async () => setLowStockThreshold(await getActor(), input))
}

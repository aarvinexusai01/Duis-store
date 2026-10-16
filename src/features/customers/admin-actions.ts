"use server"

import { refresh } from "next/cache"

import { grantGoodwillCredit } from "@/features/wallet"
import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { setCodBlock } from "./admin"

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

export async function setCodBlockAction(input: {
  userId: string
  blocked: boolean
  reason?: string
}) {
  return run(async () => setCodBlock(await getActor(), input))
}

export async function grantGoodwillAction(input: {
  userId: string
  amountPaise: number
  note: string
  idempotencyKey: string
}) {
  return run(async () => grantGoodwillCredit(await getActor(), input))
}

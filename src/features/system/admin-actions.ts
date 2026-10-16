"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { discardFailedJob, reprocessWebhook, retryFailedJob } from "./admin"

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

export async function retryFailedJobAction(queue: string, id: string) {
  return run(async () => retryFailedJob(await getActor(), { queue, id }))
}

export async function discardFailedJobAction(queue: string, id: string) {
  return run(async () => discardFailedJob(await getActor(), { queue, id }))
}

export async function reprocessWebhookAction(id: string) {
  return run(async () => reprocessWebhook(await getActor(), { id }))
}

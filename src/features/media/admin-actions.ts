"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { deleteMedia, getMediaUsage, updateMediaDetails } from "./service"

type Result<T = object> = ({ ok: true } & T) | ({ ok: false } & ActionError)
type Input<F extends (actor: never, input: never) => unknown> = Parameters<F>[1]

async function run<T extends object>(
  work: () => Promise<T>,
  refreshPage = true,
): Promise<Result<T>> {
  try {
    const value = await work()
    if (refreshPage) refresh()
    return { ok: true, ...value }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

export async function updateMediaAction(
  input: Input<typeof updateMediaDetails>,
) {
  return run(async () => updateMediaDetails(await getActor(), input))
}

export async function deleteMediaAction(id: string) {
  return run(async () => deleteMedia(await getActor(), { id }))
}

export async function mediaUsageAction(id: string) {
  return run(async () => getMediaUsage(await getActor(), { id }), false)
}

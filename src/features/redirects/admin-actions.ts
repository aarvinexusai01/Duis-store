"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { createRedirect, deleteRedirect } from "./service"

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

export async function createRedirectAction(input: {
  fromPath: string
  toPath: string
  permanent: boolean
}) {
  return run(async () => createRedirect(await getActor(), input))
}

export async function deleteRedirectAction(id: string) {
  return run(async () => deleteRedirect(await getActor(), { id }))
}

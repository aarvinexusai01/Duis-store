"use server"

import type { Route } from "next"
import { refresh } from "next/cache"
import { redirect } from "next/navigation"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { previewCollectionRules } from "./admin"
import {
  archiveCollection,
  createCollection,
  publishCollection,
  setCollectionProducts,
  updateCollection,
} from "./service"

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

export async function createCollectionAction(
  input: Input<typeof createCollection>,
) {
  const result = await run(async () =>
    createCollection(await getActor(), input),
  )
  if (result.ok) redirect(`/admin/collections/${result.id}` as Route)
  return result
}

export async function updateCollectionAction(
  input: Input<typeof updateCollection>,
) {
  return run(async () => updateCollection(await getActor(), input))
}

export async function setCollectionProductsAction(
  input: Input<typeof setCollectionProducts>,
) {
  return run(async () => {
    await setCollectionProducts(await getActor(), input)
    return {}
  })
}

export async function publishCollectionAction(id: string) {
  return run(async () => {
    await publishCollection(await getActor(), { id })
    return {}
  })
}

export async function archiveCollectionAction(id: string) {
  return run(async () => {
    await archiveCollection(await getActor(), { id })
    return {}
  })
}

export async function previewRulesAction(
  input: Input<typeof previewCollectionRules>,
) {
  return run(async () => previewCollectionRules(await getActor(), input), false)
}

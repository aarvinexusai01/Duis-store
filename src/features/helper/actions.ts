"use server"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { getHelperState, updateHelperPrefs, type HelperState } from "./service"

type Result<T> = ({ ok: true } & T) | ({ ok: false } & ActionError)

async function run<T extends object>(
  work: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return { ok: true, ...(await work()) }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

/** Fresh checklist when the helper panel opens (no page refresh needed). */
export async function getHelperStateAction(): Promise<
  Result<{ state: HelperState }>
> {
  return run(async () => ({
    state: await getHelperState(await getActor(), {}),
  }))
}

export async function setHelperHiddenAction(hidden: boolean) {
  return run(async () => updateHelperPrefs(await getActor(), { hidden }))
}

export async function completeTourAction() {
  return run(async () =>
    updateHelperPrefs(await getActor(), { tourDone: true }),
  )
}

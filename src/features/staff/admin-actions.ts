"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import {
  acceptInvitation,
  inviteStaff,
  resetStaffTwoFactor,
  revokeInvitation,
  revokeStaffSessions,
  setStaffActive,
  setStaffRoles,
} from "./admin"
import { adminSearch } from "./search"

export type AdminResult<T = object> =
  ({ ok: true } & T) | ({ ok: false } & ActionError)

async function run<T extends object>(
  work: () => Promise<T>,
  options: { refresh?: boolean } = { refresh: true },
): Promise<AdminResult<T>> {
  try {
    const value = await work()
    if (options.refresh) refresh()
    return { ok: true, ...value }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

type Input<F extends (actor: never, input: never) => unknown> = Parameters<F>[1]

export async function inviteStaffAction(input: Input<typeof inviteStaff>) {
  return run(async () => inviteStaff(await getActor(), input))
}

export async function revokeInvitationAction(id: string) {
  return run(async () => revokeInvitation(await getActor(), { id }))
}

export async function setStaffRolesAction(input: Input<typeof setStaffRoles>) {
  return run(async () => setStaffRoles(await getActor(), input))
}

export async function resetStaffTwoFactorAction(userId: string) {
  return run(async () => resetStaffTwoFactor(await getActor(), { userId }))
}

export async function setStaffActiveAction(
  input: Input<typeof setStaffActive>,
) {
  return run(async () => setStaffActive(await getActor(), input))
}

export async function revokeStaffSessionsAction(userId: string) {
  return run(async () => revokeStaffSessions(await getActor(), { userId }))
}

export async function acceptInvitationAction(
  input: Input<typeof acceptInvitation>,
) {
  return run(async () => acceptInvitation(await getActor(), input), {
    refresh: false,
  })
}

export async function adminSearchAction(q: string) {
  return run(
    async () => ({ hits: await adminSearch(await getActor(), { q }) }),
    { refresh: false },
  )
}

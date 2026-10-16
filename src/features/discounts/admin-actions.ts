"use server"

import type { Route } from "next"
import { refresh } from "next/cache"
import { redirect } from "next/navigation"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import {
  archiveDiscount,
  generateCoupons,
  setDiscountActive,
  updateDiscount,
} from "./admin"
import { createDiscount } from "./service"

export type AdminResult<T = object> =
  ({ ok: true } & T) | ({ ok: false } & ActionError)

async function run<T extends object>(
  work: () => Promise<T>,
): Promise<AdminResult<T>> {
  try {
    const value = await work()
    refresh()
    return { ok: true, ...value }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

type Input<F extends (actor: never, input: never) => unknown> = Parameters<F>[1]

export async function createDiscountAction(
  input: Input<typeof createDiscount>,
) {
  const result = await run(async () => createDiscount(await getActor(), input))
  if (result.ok) redirect(`/admin/discounts/${result.id}` as Route)
  return result
}

export async function updateDiscountAction(
  input: Input<typeof updateDiscount>,
) {
  return run(async () => updateDiscount(await getActor(), input))
}

export async function setDiscountActiveAction(id: string, active: boolean) {
  return run(async () => setDiscountActive(await getActor(), { id, active }))
}

export async function archiveDiscountAction(id: string) {
  return run(async () => archiveDiscount(await getActor(), { id }))
}

export async function generateCouponsAction(
  input: Input<typeof generateCoupons>,
) {
  return run(async () => generateCoupons(await getActor(), input))
}

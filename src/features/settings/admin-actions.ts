"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import {
  addTaxRule,
  updateCodSettings,
  updateLegalSettings,
  updateNotificationSettings,
  updatePolicySettings,
  updateShippingSettings,
} from "./admin"
import { testIntegration } from "./health"

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

export async function updateLegalSettingsAction(
  input: Input<typeof updateLegalSettings>,
) {
  return run(async () => updateLegalSettings(await getActor(), input))
}

export async function updateShippingSettingsAction(
  input: Input<typeof updateShippingSettings>,
) {
  return run(async () => updateShippingSettings(await getActor(), input))
}

export async function updateCodSettingsAction(
  input: Input<typeof updateCodSettings>,
) {
  return run(async () => updateCodSettings(await getActor(), input))
}

export async function updatePolicySettingsAction(
  input: Input<typeof updatePolicySettings>,
) {
  return run(async () => updatePolicySettings(await getActor(), input))
}

export async function updateNotificationSettingsAction(
  input: Input<typeof updateNotificationSettings>,
) {
  return run(async () => updateNotificationSettings(await getActor(), input))
}

export async function addTaxRuleAction(input: Input<typeof addTaxRule>) {
  return run(async () => addTaxRule(await getActor(), input))
}

export async function testIntegrationAction(
  target: Input<typeof testIntegration>["target"],
) {
  return run(async () => testIntegration(await getActor(), { target }))
}

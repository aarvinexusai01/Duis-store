"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import type { AddressInput } from "./schemas"
import {
  deleteAddress,
  saveAddress,
  setDeletionRequest,
  setMarketingConsent,
  updateProfile,
} from "./service"

export type ActionResult = { ok: true } | ({ ok: false } & ActionError)

async function run(work: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await work()
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

export async function saveProfileAction(input: { name: string }) {
  return run(async () => updateProfile(await getActor(), input))
}

export async function saveConsentAction(input: {
  marketingEmail: boolean
  marketingWhatsapp: boolean
}) {
  return run(async () => setMarketingConsent(await getActor(), input))
}

export async function setDeletionRequestAction(requested: boolean) {
  return run(async () => setDeletionRequest(await getActor(), { requested }))
}

export async function saveAddressAction(input: AddressInput) {
  return run(async () => saveAddress(await getActor(), input))
}

export async function deleteAddressAction(id: string) {
  return run(async () => deleteAddress(await getActor(), { id }))
}

"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import {
  addOrderNote,
  cancelShipment,
  createShipments,
  refundOrder,
  retryShipment,
  simulateTracking,
  staffCancelOrder,
  startProcessing,
  updateShippingAddress,
} from "./admin"
import { importCodRemittances } from "./remittance"

export type AdminResult<T = object> =
  ({ ok: true } & T) | ({ ok: false } & ActionError)

/** Runs an operation as the signed-in staff member and refreshes the page. */
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

export async function startProcessingAction(orderNumber: string) {
  return run(async () => startProcessing(await getActor(), { orderNumber }))
}

export async function addOrderNoteAction(input: Input<typeof addOrderNote>) {
  return run(async () => addOrderNote(await getActor(), input))
}

export async function updateShippingAddressAction(
  input: Input<typeof updateShippingAddress>,
) {
  return run(async () => updateShippingAddress(await getActor(), input))
}

export async function createShipmentsAction(
  input: Input<typeof createShipments>,
) {
  return run(async () => createShipments(await getActor(), input))
}

/** Bulk "Book parcels" from the orders list (results show in the list). */
export async function bulkShipAction(form: FormData): Promise<void> {
  const orderNumbers = form.getAll("ids").map(String)
  if (orderNumbers.length === 0) return
  try {
    await createShipments(await getActor(), { orderNumbers })
  } catch (error) {
    toActionError(error)
  }
  refresh()
}

export async function retryShipmentAction(shipmentId: string) {
  return run(async () => retryShipment(await getActor(), { shipmentId }))
}

export async function cancelShipmentAction(shipmentId: string) {
  return run(async () => cancelShipment(await getActor(), { shipmentId }))
}

export async function simulateTrackingAction(
  input: Input<typeof simulateTracking>,
) {
  return run(async () => simulateTracking(await getActor(), input))
}

export async function staffCancelOrderAction(
  input: Input<typeof staffCancelOrder>,
) {
  return run(async () => staffCancelOrder(await getActor(), input))
}

export async function refundOrderAction(input: Input<typeof refundOrder>) {
  return run(async () => refundOrder(await getActor(), input))
}

export async function importCodRemittancesAction(
  input: Input<typeof importCodRemittances>,
) {
  return run(async () => importCodRemittances(await getActor(), input))
}

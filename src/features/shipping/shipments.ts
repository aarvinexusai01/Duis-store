import "server-only"
import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import type { ShipmentCustoms, ShippingAddressSnapshot } from "@/db/schema"
import { systemActor, type Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"
import { logger } from "@/server/observability/logger"
import { readPrivateFile, writePrivateFile } from "@/server/storage/private"

import {
  getShippingProvider,
  type ShipmentRequest,
  type TrackingEvent,
} from "./provider"
import { parseShiprocketWebhook } from "./shiprocket-format"
import {
  nextShipmentStatus,
  normaliseCourierStatus,
  TERMINAL,
  type ShipmentStatus,
} from "./status"

/**
 * Parcels (doc/03 §6). Creation runs as resumable steps, each saved as soon
 * as the courier answers, so a retry never books twice what is already
 * booked. Tracking events from the webhook, the polling job and the fake
 * simulator all go through ingestTrackingEvent().
 */

export type ShipmentStatusChange = {
  shipmentId: string
  orderId: string
  from: ShipmentStatus
  to: ShipmentStatus
  occurredAt: Date
  actor: Actor
}

// Set by the orders module, which owns order status and customer emails.
let listener:
  ((tx: Transaction, change: ShipmentStatusChange) => Promise<void>) | null =
  null
export function onShipmentStatusChanged(fn: typeof listener) {
  listener = fn
}

const LEASE = sql`now() + interval '3 minutes'`

/** Inserts a pending parcel for an order (inside the caller's transaction). */
export async function createShipmentRecord(
  tx: Transaction,
  input: {
    orderId: string
    orderNumber: string
    codAmountPaise: number
    weightGrams: number
    lengthCm: number
    breadthCm: number
    heightCm: number
    customs: ShipmentCustoms | null
    items: { orderItemId: string; quantity: number }[]
    createdBy: string | null
  },
): Promise<string> {
  const count = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from shipments where order_id = ${input.orderId}`,
  )
  const channelOrderId = `${input.orderNumber}-${count.rows[0]!.n + 1}`
  try {
    const created = await tx.execute<{ id: string }>(sql`
      insert into shipments (order_id, provider, channel_order_id, cod_amount_paise, weight_grams,
                             length_cm, breadth_cm, height_cm, customs, created_by)
      values (${input.orderId}, ${getShippingProvider().name}, ${channelOrderId}, ${input.codAmountPaise},
              ${input.weightGrams}, ${input.lengthCm}, ${input.breadthCm}, ${input.heightCm},
              ${input.customs ? JSON.stringify(input.customs) : null}::jsonb, ${input.createdBy})
      returning id`)
    const id = created.rows[0]!.id
    for (const item of input.items) {
      await tx.execute(sql`
        insert into shipment_items (shipment_id, order_item_id, quantity)
        values (${id}, ${item.orderItemId}, ${item.quantity})`)
    }
    return id
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "This order already has a parcel.")
    }
    throw error
  }
}

type ShipmentRow = {
  id: string
  order_id: string
  status: ShipmentStatus
  provider: string
  channel_order_id: string
  provider_order_id: string | null
  provider_shipment_id: string | null
  awb: string | null
  courier_name: string | null
  cod_amount_paise: number
  weight_grams: number
  length_cm: number
  breadth_cm: number
  height_cm: number
  customs: ShipmentCustoms | null
  label_file_key: string | null
  last_event_at: Date | null
}

async function buildRequest(row: ShipmentRow): Promise<ShipmentRequest> {
  const db = getDb()
  const order = await db.execute<{
    placed_at: Date
    customer_email: string | null
    shipping_address: ShippingAddressSnapshot
    total_paise: number
  }>(sql`
    select placed_at, customer_email, shipping_address, total_paise from orders where id = ${row.order_id}`)
  const items = await db.execute<{
    title: string
    variant_label: string
    sku: string
    quantity: number
    unit_price_paise: number
    line_total_paise: number
    hsn_code: string
  }>(sql`
    select oi.title, oi.variant_label, oi.sku, si.quantity, oi.unit_price_paise, oi.line_total_paise, oi.hsn_code
    from shipment_items si join order_items oi on oi.id = si.order_item_id
    where si.shipment_id = ${row.id} order by oi.position`)
  const o = order.rows[0]!
  const a = o.shipping_address
  return {
    channelOrderId: row.channel_order_id,
    orderDate: new Date(o.placed_at),
    consignee: {
      name: a.fullName,
      phone: a.phone,
      email: o.customer_email?.endsWith(".invalid") ? null : o.customer_email,
      line1: [a.line1, a.landmark].filter(Boolean).join(", "),
      line2: a.line2 ?? null,
      city: a.city,
      state: a.region ?? a.stateCode ?? null,
      postalCode: a.postalCode,
      countryCode: a.countryCode,
    },
    items: items.rows.map((i) => ({
      name: `${i.title} (${i.variant_label})`,
      sku: i.sku,
      units: i.quantity,
      unitPricePaise: i.unit_price_paise,
      hsn: i.hsn_code,
    })),
    subTotalPaise: o.total_paise,
    codAmountPaise: row.cod_amount_paise,
    weightGrams: row.weight_grams,
    lengthCm: row.length_cm,
    breadthCm: row.breadth_cm,
    heightCm: row.height_cm,
    customs: row.customs,
  }
}

async function saveSteps(id: string, patch: Record<string, unknown>) {
  await getDb().execute(sql`
    update shipments set steps = steps || ${JSON.stringify(patch)}::jsonb, updated_at = now() where id = ${id}`)
}

export type AdvanceResult =
  | { status: "ready" }
  | { status: "busy" | "skipped" }
  | { status: "failed"; error: string }

/**
 * Runs the remaining creation steps: courier order → AWB → label → pickup.
 * A lease stops the inline attempt and a job retry running at once.
 */
export async function advanceShipment(
  shipmentId: string,
  actor: Actor = systemActor("shipping.create-shipment"),
): Promise<AdvanceResult> {
  const claimed = await getDb().execute<ShipmentRow>(sql`
    update shipments set lease_until = ${LEASE}, attempts = attempts + 1, updated_at = now()
    where id = ${shipmentId} and status = 'pending' and (lease_until is null or lease_until < now())
    returning *`)
  const row = claimed.rows[0]
  if (!row) {
    const current = await getDb().execute<{ status: string }>(
      sql`select status from shipments where id = ${shipmentId}`,
    )
    return {
      status: current.rows[0]?.status === "pending" ? "busy" : "skipped",
    }
  }
  const provider = getShippingProvider()
  try {
    if (provider.name !== row.provider) {
      throw new Error(
        `parcel was booked with ${row.provider}, but the courier is now ${provider.name}`,
      )
    }
    const request = await buildRequest(row)
    let providerShipmentId = row.provider_shipment_id
    if (!row.provider_order_id || !providerShipmentId) {
      const booked = await provider.createShipment(request)
      providerShipmentId = booked.providerShipmentId
      await getDb().execute(sql`
        update shipments set provider_order_id = ${booked.providerOrderId},
          provider_shipment_id = ${booked.providerShipmentId}, updated_at = now()
        where id = ${shipmentId}`)
    }
    let awb = row.awb
    let courierName = row.courier_name ?? "Courier"
    if (!awb) {
      const assigned = await provider.assignAwb(providerShipmentId)
      awb = assigned.awb
      courierName = assigned.courierName
      await getDb().execute(sql`
        update shipments set awb = ${awb}, courier_name = ${courierName}, updated_at = now()
        where id = ${shipmentId}`)
    }
    if (!row.label_file_key) {
      const pdf = await provider.label({
        providerShipmentId,
        awb,
        courierName,
        request,
      })
      const key = await writePrivateFile("labels", `${shipmentId}.pdf`, pdf)
      await getDb().execute(
        sql`update shipments set label_file_key = ${key}, updated_at = now() where id = ${shipmentId}`,
      )
      await saveSteps(shipmentId, { labelStored: true })
    }
    const pickup = await provider.requestPickup(providerShipmentId)
    await withTransaction(async (tx) => {
      await tx.execute(sql`
        update shipments set status = 'ready_to_ship', pickup_scheduled_at = ${pickup.scheduledAt},
          steps = steps || '{"pickupRequested": true}'::jsonb,
          last_error = null, lease_until = null, updated_at = now()
        where id = ${shipmentId}`)
      await listener?.(tx, {
        shipmentId,
        orderId: row.order_id,
        from: "pending",
        to: "ready_to_ship",
        occurredAt: new Date(),
        actor,
      })
    })
    logger.info({ shipmentId, awb }, "parcel booked")
    return { status: "ready" }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "courier request failed"
    await getDb().execute(sql`
      update shipments set last_error = ${message.slice(0, 500)}, lease_until = null, updated_at = now()
      where id = ${shipmentId}`)
    logger.warn({ err: error, shipmentId }, "parcel step failed")
    return { status: "failed", error: message }
  }
}

/** Retries a failed parcel in the background (shipping.create-shipment). */
export async function scheduleShipmentRetry(shipmentId: string) {
  await enqueue(
    QUEUES.createShipment,
    { shipmentId },
    { singletonKey: `shipment:${shipmentId}`, startAfter: 30 },
  )
}

/** shipping.create-shipment job: throws so pg-boss retries with backoff. */
export async function runShipmentJob(shipmentId: string): Promise<void> {
  const result = await advanceShipment(shipmentId)
  if (result.status === "failed") throw new Error(result.error)
  if (result.status === "busy") throw new Error("parcel is being booked")
}

/**
 * Cancels a parcel with the courier, before pickup only. The courier must
 * agree first; only then is the parcel marked cancelled here.
 */
export async function cancelShipmentAtCourier(
  shipmentId: string,
  actor: Actor,
): Promise<{ orderId: string }> {
  const claimed = await getDb().execute<ShipmentRow>(sql`
    update shipments set lease_until = ${LEASE}, updated_at = now()
    where id = ${shipmentId} and status in ('pending', 'ready_to_ship')
      and (lease_until is null or lease_until < now())
    returning *`)
  const row = claimed.rows[0]
  if (!row) {
    const current = await getDb().execute<{ status: ShipmentStatus }>(
      sql`select status from shipments where id = ${shipmentId}`,
    )
    const status = current.rows[0]?.status
    if (!status) throw new DomainError("NOT_FOUND", "Parcel not found.")
    if (status === "cancelled") return { orderId: "" }
    throw new DomainError(
      status === "pending" ? "CONFLICT" : "INVALID_STATE",
      status === "pending"
        ? "This parcel is being booked right now. Try again in a minute."
        : "The courier has already picked this parcel up, so it can't be cancelled.",
    )
  }
  try {
    if (row.provider_order_id) {
      await getShippingProvider().cancel({
        providerOrderId: row.provider_order_id,
        awb: row.awb,
      })
    }
  } catch (error) {
    await getDb().execute(
      sql`update shipments set lease_until = null where id = ${shipmentId}`,
    )
    logger.warn({ err: error, shipmentId }, "courier refused cancellation")
    throw new DomainError(
      "CONFLICT",
      "The courier could not cancel this parcel. Try again, or cancel it in the courier panel.",
    )
  }
  await withTransaction(async (tx) => {
    await tx.execute(sql`
      update shipments set status = 'cancelled', cancelled_at = now(), lease_until = null, updated_at = now()
      where id = ${shipmentId}`)
    await listener?.(tx, {
      shipmentId,
      orderId: row.order_id,
      from: row.status,
      to: "cancelled",
      occurredAt: new Date(),
      actor,
    })
  })
  return { orderId: row.order_id }
}

export type IngestResult =
  "unknown_parcel" | "duplicate" | "recorded" | "applied"

/**
 * Stores one courier event (deduplicated on parcel, status and time) and
 * moves the parcel forward if the event is newer; never backwards.
 */
export async function ingestTrackingEvent(
  target: { awb: string } | { shipmentId: string },
  event: TrackingEvent,
  options: { raw?: unknown; actor?: Actor } = {},
): Promise<IngestResult> {
  const actor = options.actor ?? systemActor("shipping.tracking")
  return withTransaction(async (tx) => {
    const found = await tx.execute<ShipmentRow>(sql`
      select * from shipments
      where ${"awb" in target ? sql`awb = ${target.awb}` : sql`id = ${target.shipmentId}`}
      for update`)
    const row = found.rows[0]
    if (!row) return "unknown_parcel"
    const status = normaliseCourierStatus(event.providerStatus)
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into shipment_tracking_events (shipment_id, provider_status, status, location, description, occurred_at, raw)
      values (${row.id}, ${event.providerStatus}, ${status}, ${event.location}, ${event.description},
              ${event.occurredAt}, ${options.raw === undefined ? null : JSON.stringify(options.raw)}::jsonb)
      on conflict (shipment_id, provider_status, occurred_at) do nothing
      returning id`)
    if (!inserted.rows[0]) return "duplicate"
    if (!status) {
      logger.warn(
        { shipmentId: row.id, providerStatus: event.providerStatus },
        "unmapped courier status",
      )
    }
    const lastEventAt = row.last_event_at ? new Date(row.last_event_at) : null
    const next = nextShipmentStatus(row.status, lastEventAt, {
      status,
      occurredAt: event.occurredAt,
    })
    await tx.execute(sql`
      update shipments set
        last_event_at = greatest(last_event_at, ${event.occurredAt}),
        status = coalesce(${next}::shipment_status, status),
        shipped_at = case when ${next} = 'picked_up' then coalesce(shipped_at, ${event.occurredAt}) else shipped_at end,
        delivered_at = case when ${next} = 'delivered' then ${event.occurredAt} else delivered_at end,
        updated_at = now()
      where id = ${row.id}`)
    if (!next) return "recorded"
    await listener?.(tx, {
      shipmentId: row.id,
      orderId: row.order_id,
      from: row.status,
      to: next,
      occurredAt: event.occurredAt,
      actor,
    })
    return "applied"
  })
}

/**
 * Stores a verified tracking webhook once and hands it to a job, so the
 * courier gets a fast answer and a redelivery is a no-op.
 */
export async function recordTrackingWebhook(
  payload: unknown,
): Promise<boolean> {
  const parsed = parseShiprocketWebhook(payload)
  if (!parsed) return false
  const inserted = await getDb().execute<{ id: string }>(sql`
    insert into webhook_events (provider, event_id, event_type, payload)
    values ('shiprocket', ${parsed.eventId}, 'tracking', ${JSON.stringify(payload)}::jsonb)
    on conflict (provider, event_id) do nothing
    returning id`)
  const id = inserted.rows[0]?.id
  if (id) await enqueue(QUEUES.processTracking, { webhookEventId: id })
  return Boolean(id)
}

/** shipping.process-tracking job. */
export async function processTrackingWebhook(
  webhookEventId: string,
): Promise<IngestResult | "skipped"> {
  const loaded = await getDb().execute<{ payload: unknown; status: string }>(
    sql`select payload, status from webhook_events where id = ${webhookEventId}`,
  )
  const row = loaded.rows[0]
  if (!row || row.status === "processed" || row.status === "ignored")
    return "skipped"
  const parsed = parseShiprocketWebhook(row.payload)
  const result = parsed
    ? await ingestTrackingEvent({ awb: parsed.awb }, parsed.event, {
        raw: row.payload,
      })
    : "unknown_parcel"
  await getDb().execute(sql`
    update webhook_events set
      status = ${result === "unknown_parcel" ? "ignored" : "processed"}::webhook_status,
      attempts = attempts + 1, processed_at = now()
    where id = ${webhookEventId}`)
  return result
}

/**
 * shipping.sync-tracking job: asks the courier about parcels with no update
 * for six hours (the webhook's fallback).
 */
export async function syncActiveShipments(batchSize = 50): Promise<number> {
  const due = await getDb().execute<{ id: string; awb: string }>(sql`
    select id, awb from shipments
    where status not in ('pending', 'delivered', 'rto_delivered', 'cancelled', 'lost')
      and awb is not null and provider = ${getShippingProvider().name}
      and coalesce(last_event_at, created_at) < now() - interval '6 hours'
      and (last_synced_at is null or last_synced_at < now() - interval '6 hours')
    order by last_synced_at nulls first limit ${batchSize}`)
  let applied = 0
  for (const shipment of due.rows) {
    try {
      const events = await getShippingProvider().track(shipment.awb)
      for (const event of events) {
        const result = await ingestTrackingEvent(
          { shipmentId: shipment.id },
          event,
        )
        if (result === "applied") applied += 1
      }
      await getDb().execute(
        sql`update shipments set last_synced_at = now() where id = ${shipment.id}`,
      )
    } catch (error) {
      logger.warn(
        { err: error, shipmentId: shipment.id },
        "tracking sync failed",
      )
    }
  }
  return applied
}

const NEXT_WORD: Partial<Record<ShipmentStatus, string>> = {
  ready_to_ship: "PICKED UP",
  picked_up: "IN TRANSIT",
  in_transit: "OUT FOR DELIVERY",
  out_for_delivery: "DELIVERED",
  undelivered: "OUT FOR DELIVERY",
  rto_initiated: "RTO DELIVERED",
}

/**
 * Development and tests only: plays the next courier scan for a fake parcel,
 * through the same path as a real webhook.
 */
export async function simulateTrackingEvent(
  shipmentId: string,
  outcome: "next" | "undelivered" | "rto",
  actor: Actor,
): Promise<ShipmentStatus> {
  if (
    getServerEnv().APP_ENV === "production" ||
    getShippingProvider().name !== "fake"
  ) {
    throw new DomainError(
      "FORBIDDEN",
      "Tracking can only be simulated with the fake courier.",
    )
  }
  const found = await getDb().execute<{
    status: ShipmentStatus
    provider: string
    last_event_at: Date | null
  }>(
    sql`select status, provider, last_event_at from shipments where id = ${shipmentId}`,
  )
  const row = found.rows[0]
  if (!row || row.provider !== "fake")
    throw new DomainError("NOT_FOUND", "Parcel not found.")
  const word =
    outcome === "rto" && row.status !== "rto_initiated"
      ? ["picked_up", "in_transit", "out_for_delivery", "undelivered"].includes(
          row.status,
        )
        ? "RTO INITIATED"
        : null
      : outcome === "undelivered"
        ? row.status === "out_for_delivery"
          ? "UNDELIVERED"
          : null
        : NEXT_WORD[row.status]
  if (!word || TERMINAL.includes(row.status)) {
    throw new DomainError(
      "INVALID_STATE",
      "There is no next scan for this parcel.",
    )
  }
  const last = row.last_event_at ? new Date(row.last_event_at).getTime() : 0
  await ingestTrackingEvent(
    { shipmentId },
    {
      providerStatus: word,
      occurredAt: new Date(Math.max(Date.now(), last + 1000)),
      location: "Demo hub",
      description: "Simulated scan",
    },
    { actor },
  )
  const after = await getDb().execute<{ status: ShipmentStatus }>(
    sql`select status from shipments where id = ${shipmentId}`,
  )
  return after.rows[0]!.status
}

export async function readShipmentLabel(
  shipmentId: string,
): Promise<{ data: Buffer; awb: string | null } | null> {
  const found = await getDb().execute<{
    label_file_key: string | null
    awb: string | null
  }>(sql`select label_file_key, awb from shipments where id = ${shipmentId}`)
  const row = found.rows[0]
  if (!row?.label_file_key) return null
  const data = await readPrivateFile(row.label_file_key)
  return data ? { data, awb: row.awb } : null
}

/**
 * Customs lines for an export parcel. DDU: the customer pays import duties,
 * as checkout tells them before they pay (ADR-018).
 */
export function customsFor(
  items: {
    title: string
    hsnCode: string
    quantity: number
    lineTotalPaise: number
    countryOfOrigin: string | null
  }[],
): ShipmentCustoms {
  return {
    terms: "DDU",
    lines: items.map((item) => ({
      description: item.title,
      hsCode: item.hsnCode,
      quantity: item.quantity,
      declaredValuePaise: item.lineTotalPaise,
      countryOfOrigin: item.countryOfOrigin ?? "IN",
    })),
  }
}

import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import type { ShipmentStatus } from "@/features/shipping"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

/**
 * Tracking links (doc/06 Phase 5 §2): /track/DUIS-100001?t=… opens without
 * signing in. The token is an HMAC of the order number, so it can't be
 * guessed for other orders. The page shows parcel progress and the city
 * only: no names, addresses or amounts.
 */
export function trackingToken(orderNumber: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`track:${orderNumber}`)
    .digest("base64url")
    .slice(0, 22)
}

export function trackingUrl(orderNumber: string): string {
  return new URL(
    `/track/${orderNumber}?t=${trackingToken(orderNumber)}`,
    getServerEnv().APP_URL,
  ).toString()
}

function validToken(orderNumber: string, token: string): boolean {
  const expected = Buffer.from(trackingToken(orderNumber))
  const given = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export type Tracking = {
  orderNumber: string
  status: string
  placedAt: Date
  city: string
  parcels: {
    kind: "order" | "return" | "replacement"
    status: ShipmentStatus
    courier: string | null
    awb: string | null
    events: {
      status: ShipmentStatus | null
      label: string
      location: string | null
      at: Date
    }[]
  }[]
}

export const getTracking = defineOperation({
  name: "orders.tracking",
  access: "public",
  input: z.object({
    orderNumber: z.string().regex(/^DUIS-\d{6,}$/),
    token: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  async handler(_ctx, { orderNumber, token }): Promise<Tracking> {
    if (!validToken(orderNumber, token)) {
      throw new DomainError("NOT_FOUND", "Tracking link not found.")
    }
    const db = getDb()
    const order = await db.execute<{
      id: string
      status: string
      placed_at: Date
      city: string
    }>(sql`
      select id, status, placed_at, shipping_address->>'city' as city from orders
      where order_number = ${orderNumber} and status <> 'expired'`)
    const o = order.rows[0]
    if (!o) throw new DomainError("NOT_FOUND", "Tracking link not found.")
    const [parcels, events] = await Promise.all([
      db.execute<{
        id: string
        direction: "forward" | "reverse" | "replacement"
        status: ShipmentStatus
        courier_name: string | null
        awb: string | null
      }>(sql`
        select id, direction, status, courier_name, awb from shipments
        where order_id = ${o.id} and status <> 'cancelled' order by created_at`),
      db.execute<{
        shipment_id: string
        status: ShipmentStatus | null
        provider_status: string
        location: string | null
        occurred_at: Date
      }>(sql`
        select e.shipment_id, e.status, e.provider_status, e.location, e.occurred_at
        from shipment_tracking_events e join shipments s on s.id = e.shipment_id
        where s.order_id = ${o.id} order by e.occurred_at desc`),
    ])
    return {
      orderNumber,
      status: o.status,
      placedAt: new Date(o.placed_at),
      city: o.city,
      parcels: parcels.rows.map((p) => ({
        kind:
          p.direction === "forward"
            ? "order"
            : p.direction === "reverse"
              ? "return"
              : "replacement",
        status: p.status,
        courier: p.courier_name,
        awb: p.awb,
        events: events.rows
          .filter((e) => e.shipment_id === p.id)
          .map((e) => ({
            status: e.status,
            label: e.provider_status,
            location: e.location,
            at: new Date(e.occurred_at),
          })),
      })),
    }
  },
})

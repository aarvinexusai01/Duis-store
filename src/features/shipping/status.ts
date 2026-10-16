/**
 * Courier status words → our shipment states (doc/03 §6), and the rule that
 * keeps a shipment from moving backwards. Pure, so it is unit-tested; the
 * Shiprocket words are from its documentation and are re-checked with the
 * first real test shipment (doc/10 A5).
 */
export type ShipmentStatus =
  | "pending"
  | "ready_to_ship"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "undelivered"
  | "delivered"
  | "rto_initiated"
  | "rto_delivered"
  | "cancelled"
  | "lost"

const WORDS: Record<string, ShipmentStatus> = {
  "AWB ASSIGNED": "ready_to_ship",
  "LABEL GENERATED": "ready_to_ship",
  "PICKUP GENERATED": "ready_to_ship",
  "PICKUP QUEUED": "ready_to_ship",
  "PICKUP SCHEDULED": "ready_to_ship",
  "PICKUP RESCHEDULED": "ready_to_ship",
  "OUT FOR PICKUP": "ready_to_ship",
  "PICKUP EXCEPTION": "ready_to_ship",
  "PICKUP ERROR": "ready_to_ship",
  "MANIFEST GENERATED": "ready_to_ship",
  "PICKED UP": "picked_up",
  SHIPPED: "in_transit",
  "IN TRANSIT": "in_transit",
  "REACHED AT DESTINATION HUB": "in_transit",
  "REACHED DESTINATION HUB": "in_transit",
  "REACHED WAREHOUSE": "in_transit",
  MISROUTED: "in_transit",
  DELAYED: "in_transit",
  "OUT FOR DELIVERY": "out_for_delivery",
  UNDELIVERED: "undelivered",
  "DELIVERY FAILED": "undelivered",
  DELIVERED: "delivered",
  "RTO INITIATED": "rto_initiated",
  "RTO IN TRANSIT": "rto_initiated",
  "RTO OFD": "rto_initiated",
  "RTO NDR": "rto_initiated",
  "RTO DELIVERED": "rto_delivered",
  "RTO ACKNOWLEDGED": "rto_delivered",
  CANCELED: "cancelled",
  CANCELLED: "cancelled",
  LOST: "lost",
  DAMAGED: "lost",
  DESTROYED: "lost",
}

export function normaliseCourierStatus(word: string): ShipmentStatus | null {
  const key = word
    .toUpperCase()
    .replace(/[\s_-]+/g, " ")
    .trim()
  return WORDS[key] ?? null
}

export const TERMINAL: readonly ShipmentStatus[] = [
  "delivered",
  "rto_delivered",
  "cancelled",
  "lost",
]

// Out for delivery and undelivered alternate between attempts: same rank.
const RANK: Record<ShipmentStatus, number> = {
  pending: 0,
  ready_to_ship: 1,
  picked_up: 2,
  in_transit: 3,
  out_for_delivery: 4,
  undelivered: 4,
  delivered: 5,
  rto_initiated: 6,
  rto_delivered: 7,
  cancelled: 8,
  lost: 8,
}

/**
 * The state after a courier event, or null when the event changes nothing.
 * Finished shipments never change; otherwise a shipment only moves forward,
 * and between equal ranks only a newer event wins (out-of-order delivery).
 */
export function nextShipmentStatus(
  current: ShipmentStatus,
  lastEventAt: Date | null,
  event: { status: ShipmentStatus | null; occurredAt: Date },
): ShipmentStatus | null {
  const target = event.status
  if (!target || target === current || target === "pending") return null
  if (TERMINAL.includes(current)) return null
  if (RANK[target] > RANK[current]) return target
  if (
    RANK[target] === RANK[current] &&
    (!lastEventAt || event.occurredAt >= lastEventAt)
  )
    return target
  return null
}

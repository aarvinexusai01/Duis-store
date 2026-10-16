/** Customer-facing words for order states. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  processing: "Being packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  expired: "Not completed",
  rto_initiated: "Returning to us",
  rto_delivered: "Returned to us",
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: "Unpaid",
  partially_paid: "Advance paid",
  paid: "Paid",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
}

export type StatusTone = "neutral" | "good" | "warn" | "bad" | "info"

export const ORDER_STATUS_TONE: Record<string, StatusTone> = {
  pending_payment: "warn",
  confirmed: "info",
  processing: "info",
  shipped: "info",
  out_for_delivery: "info",
  delivered: "good",
  cancelled: "bad",
  expired: "neutral",
  rto_initiated: "warn",
  rto_delivered: "bad",
}

export const PAYMENT_STATUS_TONE: Record<string, StatusTone> = {
  unpaid: "warn",
  partially_paid: "info",
  paid: "good",
  partially_refunded: "warn",
  refunded: "neutral",
}

/** Staff words for parcel states (doc/03 §6). */
export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Booking",
  ready_to_ship: "Ready to ship",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  undelivered: "Delivery failed",
  delivered: "Delivered",
  rto_initiated: "Returning",
  rto_delivered: "Returned",
  cancelled: "Cancelled",
  lost: "Lost",
}

export const SHIPMENT_STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  ready_to_ship: "info",
  picked_up: "info",
  in_transit: "info",
  out_for_delivery: "info",
  undelivered: "warn",
  delivered: "good",
  rto_initiated: "warn",
  rto_delivered: "bad",
  cancelled: "neutral",
  lost: "bad",
}

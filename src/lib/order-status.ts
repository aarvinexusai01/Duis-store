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

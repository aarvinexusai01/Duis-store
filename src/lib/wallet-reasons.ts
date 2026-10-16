/** Customer-facing words for wallet ledger entries. */
export const WALLET_REASON_LABEL: Record<string, string> = {
  order_payment: "Used on an order",
  order_reversal: "Returned (order not completed)",
  cancellation_refund: "Refund for a cancelled order",
  order_refund: "Refund on an order",
  exchange_credit: "Exchange credit",
  goodwill: "Credit from Duis",
  rto_advance_credit: "Advance credited back",
  expiry: "Expired promotional credit",
  adjustment: "Adjustment",
}

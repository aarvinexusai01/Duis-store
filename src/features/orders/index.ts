// Public surface of the orders module (doc/04 §7, rule 2).
export {
  cancelOrder,
  confirmInTransaction,
  confirmWalletPaidOrder,
  expirePendingOrders,
  lockOrder,
  reconcilePendingPayments,
  recordChange,
  settleCapturedPayment,
  walletKey,
  type OrderRow,
  type SettleResult,
} from "./lifecycle"
export { processWebhookEvent, recordWebhook } from "./events"
export {
  getMyOrder,
  listMyOrders,
  type OrderDetail,
  type OrderSummary,
} from "./queries"

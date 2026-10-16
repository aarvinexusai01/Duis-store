// Public surface of the orders module (doc/04 §7, rule 2).
// Registers the parcel → order listener wherever orders are loaded.
import "./fulfilment"

export {
  cancelConfirmedOrder,
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
export { orderStatusAfter } from "./fulfilment"
export { processWebhookEvent, recordWebhook } from "./events"
export {
  getMyOrder,
  listMyOrders,
  type OrderDetail,
  type OrderSummary,
} from "./queries"
export {
  ADMIN_ORDERS_PAGE_SIZE,
  ORDER_VIEWS,
  addOrderNote,
  adminGetOrder,
  adminListOrders,
  canSeeMoney,
  cancelShipment,
  createShipments,
  getShipmentLabel,
  refundOrder,
  retryShipment,
  simulateTracking,
  staffCancelOrder,
  startProcessing,
  updateShippingAddress,
  type AdminOrderDetail,
  type AdminOrderRow,
} from "./admin"
export {
  importCodRemittances,
  listCodOutstanding,
  type RemittanceProblem,
} from "./remittance"

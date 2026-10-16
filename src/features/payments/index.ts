// Public surface of the payments module (doc/04 §7, rule 2).
export {
  FAKE_GATEWAY_SECRET,
  GatewayError,
  getPaymentGateway,
  hmacHex,
  simulateFakePayment,
  type GatewayPayment,
  type PaymentGateway,
} from "./gateway"
export {
  applyRefundResult,
  captureIfAuthorized,
  ensureGatewayOrder,
  lockPaymentByProviderOrder,
  markAttemptFailed,
  markCaptured,
  onRefundProcessed,
  processRefund,
  requestRefund,
  type PaymentRow,
} from "./service"

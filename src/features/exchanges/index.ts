// Public surface of the exchanges module (doc/04 §7, rule 2).
// Loading it registers the parcel and payment listeners.
export {
  cancelMyExchange,
  getExchangeOptions,
  REASON_LABEL,
  requestExchange,
  startExchangePayment,
  type CustomerExchange,
  type ExchangeableItem,
  type ExchangeOption,
} from "./service"
export {
  adminGetExchange,
  adminListExchanges,
  approveExchange,
  EXCHANGES_PAGE_SIZE,
  failExchangeQc,
  markExchangeReceived,
  passExchangeQc,
  rejectExchange,
  type AdminExchangeDetail,
  type AdminExchangeRow,
} from "./admin"
export type { ExchangeStatus } from "./core"

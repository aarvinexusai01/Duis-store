// Public surface of the inventory module (doc/04 §7, rule 2).
export {
  adjustStock,
  commitReservations,
  createStockLocation,
  expireReservations,
  getAvailability,
  receiveReturnedStock,
  releaseReservations,
  reserveStock,
  restockCommitted,
  setLowStockThreshold,
  type ReservationHolder,
  type ReservationLine,
} from "./service"
export {
  adminListMovements,
  adminListStock,
  setCountedStock,
  STOCK_PAGE_SIZE,
  type MovementRow,
  type StockRow,
} from "./admin"
export { sendLowStockDigest } from "./digest"

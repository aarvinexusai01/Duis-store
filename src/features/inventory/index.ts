// Public surface of the inventory module (doc/04 §7, rule 2).
export {
  adjustStock,
  commitReservations,
  createStockLocation,
  expireReservations,
  getAvailability,
  releaseReservations,
  reserveStock,
  setLowStockThreshold,
  type ReservationHolder,
  type ReservationLine,
} from "./service"

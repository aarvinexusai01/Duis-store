// Public surface of the shipping module (doc/04 §7, rule 2).
export { checkServiceability, pincodeSchema } from "./service"
export {
  getShippingProvider,
  type RateRequest,
  type Serviceability,
  type TrackingEvent,
} from "./provider"
export { failFakeShippingStep } from "./fake-provider"
export {
  advanceShipment,
  cancelShipmentAtCourier,
  createShipmentRecord,
  customsFor,
  ingestTrackingEvent,
  onShipmentStatusChanged,
  processTrackingWebhook,
  readShipmentLabel,
  recordTrackingWebhook,
  runShipmentJob,
  scheduleShipmentRetry,
  simulateTrackingEvent,
  syncActiveShipments,
  type AdvanceResult,
  type IngestResult,
  type ShipmentStatusChange,
} from "./shipments"
export {
  nextShipmentStatus,
  normaliseCourierStatus,
  type ShipmentStatus,
} from "./status"

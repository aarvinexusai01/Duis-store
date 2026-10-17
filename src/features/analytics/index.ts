// Public surface of the analytics module (doc/04 §7, rule 2).
export {
  buildMetaPurchase,
  purchaseEventId,
  queueMetaPurchase,
  recordConsent,
  sendMetaPurchase,
} from "./service"
export { marketingContextSchema } from "./schemas"
export {
  CONSENT_COOKIE,
  CONSENT_VERSION,
  parseConsent,
  type ConsentChoice,
} from "./consent"

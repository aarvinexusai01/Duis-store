// Public surface of the checkout module (doc/04 §7, rule 2).
export {
  buildCheckoutContext,
  hashQuote,
  loadStoreSettings,
  type CheckoutChoices,
  type StoreSettings,
} from "./context"
export {
  getCheckoutQuote,
  placeOrder,
  simulatePayment,
  startPayment,
  verifyPayment,
  type CheckoutView,
  type PaymentOptions,
  type PlaceResult,
} from "./service"

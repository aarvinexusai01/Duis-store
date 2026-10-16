// Public surface of the shipping module (doc/04 §7, rule 2).
export { checkServiceability, pincodeSchema } from "./service"
export {
  getShippingProvider,
  type RateRequest,
  type Serviceability,
} from "./provider"

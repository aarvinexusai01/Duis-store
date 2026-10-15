// Public surface of the customers module (doc/04 §7, rule 2).
export {
  deleteAddress,
  getAccountOverview,
  listAddresses,
  saveAddress,
  setDeletionRequest,
  setMarketingConsent,
  updateProfile,
  type AccountOverview,
  type Address,
} from "./service"
export { addressInputSchema, type AddressInput } from "./schemas"

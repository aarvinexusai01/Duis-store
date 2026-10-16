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
export {
  ADMIN_CUSTOMERS_PAGE_SIZE,
  adminGetCustomer,
  adminListCustomers,
  setCodBlock,
  type AdminCustomerDetail,
  type AdminCustomerRow,
} from "./admin"

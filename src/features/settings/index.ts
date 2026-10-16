// Public surface of the settings module (doc/04 §7, rule 2).
export {
  addTaxRule,
  getAdminSettings,
  updateCodSettings,
  updateLegalSettings,
  updateNotificationSettings,
  updatePolicySettings,
  updateShippingSettings,
  type AdminSettings,
} from "./admin"
export {
  getIntegrationHealth,
  testIntegration,
  type IntegrationStatus,
} from "./health"
export { describeCodAdvance, loadStorePolicy, type StorePolicy } from "./policy"
export { getStorePolicy } from "./queries"

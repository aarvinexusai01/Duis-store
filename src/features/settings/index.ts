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
export { getStorefrontUsdPricing, getStorePolicy } from "./queries"
export {
  fetchUsdRateNow,
  getUsdPricingAdmin,
  loadEffectiveUsdRate,
  loadStorefrontUsdPricing,
  refreshUsdRate,
  saveCountryPricing,
  setUsdPricingEnabled,
  updateUsdRateSettings,
  type EffectiveRate,
  type UsdPricingAdmin,
} from "./usd"

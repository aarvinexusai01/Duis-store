// Public surface of the collections module (doc/04 §7, rule 2).
export {
  archiveCollection,
  createCollection,
  publishCollection,
  refreshAutomaticCollections,
  scheduleCollectionRefresh,
  setCollectionProducts,
  updateCollection,
} from "./service"
export { collectionRuleSchema, type CollectionRuleInput } from "./schemas"
export {
  loadCollectionBySlug,
  loadCollectionProductIds,
  loadCollectionsByIds,
  loadPublishedCollections,
  type CollectionSummary,
} from "./storefront"
export {
  adminGetCollection,
  adminListCollections,
  previewCollectionRules,
  type AdminCollection,
  type AdminCollectionRow,
} from "./admin"

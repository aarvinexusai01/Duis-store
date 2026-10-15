// Public surface of the catalog module (doc/04 §7, rule 2).
export {
  archiveProduct,
  createAttribute,
  createAttributeValue,
  createCategory,
  createDepartment,
  createProduct,
  createSizeChart,
  generateVariants,
  moveCategory,
  publishProduct,
  setProductMedia,
  updateCategory,
  updateProduct,
  updateVariant,
} from "./service"
export { refreshListingCache, refreshSearchKeywords } from "./derived"

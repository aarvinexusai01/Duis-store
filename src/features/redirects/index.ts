// Public surface of the redirects module (doc/04 §7, rule 2).
export {
  adminListRedirects,
  createRedirect,
  deleteRedirect,
  recordAddressChange,
  REDIRECTS_PAGE_SIZE,
  releaseAddress,
  type RedirectRow,
} from "./service"
export { isRedirectable, normalizePath } from "./paths"

// Public surface of the media module (doc/04 §7, rule 2).
export {
  deleteMedia,
  mediaUsage,
  updateMediaDetails,
  uploadImage,
  type UploadedMedia,
} from "./service"
export { readCustomerPhoto, uploadCustomerPhoto } from "./customer-photos"

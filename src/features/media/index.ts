// Public surface of the media module (doc/04 §7, rule 2).
export {
  adminListMedia,
  deleteMedia,
  getMediaUsage,
  MEDIA_PAGE_SIZE,
  type MediaListItem,
  type MediaUse,
  mediaUsage,
  updateMediaDetails,
  uploadImage,
  type UploadedMedia,
} from "./service"
export { readCustomerPhoto, uploadCustomerPhoto } from "./customer-photos"

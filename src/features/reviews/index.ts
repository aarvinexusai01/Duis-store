// Public surface of the reviews module (doc/04 §7, rule 2).
export {
  adminListReviews,
  displayNameFor,
  listReviewableItems,
  loadProductReviews,
  moderateReview,
  REVIEWS_PAGE_SIZE,
  sendReviewRequests,
  submitReview,
  type ProductReviews,
} from "./service"
export { getProductReviews } from "./queries"

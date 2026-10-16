// Public surface of the discounts module (doc/04 §7, rule 2).
export {
  createDiscount,
  createDiscountSchema,
  findUsableCoupon,
  loadAutomaticDiscounts,
  redeemCoupon,
  reverseCouponRedemption,
} from "./service"
export { discountFieldsSchema } from "./service"
export {
  ADMIN_DISCOUNTS_PAGE_SIZE,
  adminGetDiscount,
  adminListDiscounts,
  archiveDiscount,
  generateCoupons,
  setDiscountActive,
  updateDiscount,
  type AdminDiscountDetail,
  type AdminDiscountRow,
} from "./admin"

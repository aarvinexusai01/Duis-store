// Public surface of the discounts module (doc/04 §7, rule 2).
export {
  createDiscount,
  createDiscountSchema,
  findUsableCoupon,
  loadAutomaticDiscounts,
  redeemCoupon,
  reverseCouponRedemption,
} from "./service"

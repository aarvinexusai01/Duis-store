// Public surface of the pricing module (doc/04 §7, rule 2). Pure: safe anywhere.
export {
  allocate,
  quote,
  quoteFingerprint,
  splitTax,
  taxRateFor,
  type DiscountTarget,
  type PaymentModeInput,
  type PricingCoupon,
  type PricingDiscount,
  type PricingLine,
  type Quote,
  type QuoteDiscount,
  type QuoteInput,
  type QuoteIssue,
  type QuoteLine,
  type TaxRule,
} from "./engine"

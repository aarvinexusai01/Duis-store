/**
 * Commerce rules from doc/01 (decisions D5–D8, D14). The storefront shows
 * them and the cart enforces them. Phase 3 moves the editable ones into
 * `store_settings`; until then this is the single source.
 */
export const STORE_POLICY = {
  freeShippingThresholdPaise: 99_900,
  exchangeWindowDays: 10,
  exchangesPerItem: 2,
  codAdvancePaise: 10_000,
  codMaxOrderPaise: 250_000,
  codFeePaise: 500,
  // Matches the CHECK on cart_items.quantity.
  maxQuantityPerLine: 10,
  // "Only N left" appears at or below this many units, never above it.
  lowStockNoticeAt: 5,
} as const

/**
 * Fixed commerce rules. The editable ones (free-shipping threshold, COD and
 * exchange values) live in `store_settings` and are read through
 * features/settings (Phase 4c).
 */
export const STORE_POLICY = {
  // Matches the CHECK on cart_items.quantity.
  maxQuantityPerLine: 10,
  // "Only N left" appears at or below this many units, never above it.
  lowStockNoticeAt: 5,
} as const

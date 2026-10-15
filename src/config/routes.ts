import type { Route } from "next"

// Typed routes cannot express the bare path of an optional catch-all
// (`/shop/[[...slug]]`), so the shop root is declared once here.
export const SHOP_HREF = "/shop" as Route

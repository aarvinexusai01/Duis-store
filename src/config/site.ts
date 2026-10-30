/**
 * Public site constants, safe for client bundles. Anything that differs per
 * environment (the origin, keys) comes from the runtime environment instead.
 */
export const SITE = {
  name: "Duis",
  defaultTitle: "Duis — Men's Streetwear",
  defaultDescription:
    "Oversized tees, graphic tees, shirts, hoodies and sweatshirts for men. Shipping across India and worldwide.",
} as const

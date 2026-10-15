// Kept free of zod: client components import SLUG (via listing-params), so
// the schema lives in ./slug-schema and zod stays out of the browser bundle.

/** URL slugs: lowercase letters, digits and single hyphens. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "")
}

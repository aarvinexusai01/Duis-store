/**
 * Each CMS page's one public address (also used by the request proxy, so it
 * has no server or database imports): the friendly ones, the policies under
 * /policies, everything else under /pages.
 */

const FRIENDLY_PAGES: Record<string, string> = {
  home: "/",
  about: "/about",
  contact: "/contact",
  faq: "/faq",
  "size-guide": "/size-guide",
}
const POLICY_PAGES = new Set([
  "privacy-policy",
  "terms-of-service",
  "shipping-policy",
  "exchange-policy",
  "cancellation-policy",
])

export function pageHref(slug: string): string {
  if (FRIENDLY_PAGES[slug]) return FRIENDLY_PAGES[slug]
  if (POLICY_PAGES.has(slug)) return `/policies/${slug}`
  return `/pages/${slug}`
}

/**
 * The canonical address when `pathname` is another way to reach a CMS page
 * (/pages/shipping-policy → /policies/shipping-policy), else null.
 */
export function canonicalPagePath(pathname: string): string | null {
  const match = /^\/(?:pages|policies)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(
    pathname,
  )
  if (!match) return null
  const canonical = pageHref(match[1]!)
  return canonical === pathname ? null : canonical
}

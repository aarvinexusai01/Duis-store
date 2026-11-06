import type { Currency, UsdPricing } from "./fx"

/**
 * Which currency the shop shows a visitor (doc/06 Phase 13d, ADR-0034).
 * Pages are rendered in rupees for everyone, so the page cache and search
 * engines see one version; the browser then asks /api/pricing for this
 * visitor's terms and converts on screen. Checkout always prices by the
 * delivery country, whatever is shown here.
 */

/** The visitor's own choice from the header switch ("INR" or "USD"). */
export const DISPLAY_CURRENCY_COOKIE = "duis_cur"

/** What the browser remembers so a dollar visitor's next page hides rupees. */
export const LAST_CURRENCY_KEY = "duis.cur"

/** Set on <html> by PRICE_PENDING_SCRIPT; prices stay hidden while it's there. */
export const PRICE_PENDING_ATTRIBUTE = "data-price-pending"

/**
 * Runs before the page paints, so a visitor who last saw dollars doesn't
 * see rupee prices flash first. Never more than two seconds, so prices
 * can't stay hidden if the app's JavaScript fails.
 */
export const PRICE_PENDING_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(LAST_CURRENCY_KEY)})==="USD"){var d=document.documentElement;d.setAttribute("${PRICE_PENDING_ATTRIBUTE}","");setTimeout(function(){d.removeAttribute("${PRICE_PENDING_ATTRIBUTE}")},2000)}}catch(e){}`

/** The storefront terms: null while dollar prices are switched off. */
export type StorefrontUsdPricing = {
  rateMicros: number
  defaultUpliftBp: number
  /** Countries with their own increase; others use the default. */
  countryUpliftBp: Record<string, number>
} | null

/** /api/pricing's answer for one visitor. */
export type VisitorPricing = {
  /** Null: rupees only, and no switch. */
  usd: UsdPricing | null
  /** Shown until the visitor picks one. */
  suggested: Currency
  country: string | null
}

// Search engines and link previews. Googlebot crawls mostly from the US, so
// it must keep seeing the rupee prices that the structured data carries.
const CRAWLER =
  /bot\b|bot\/|crawl|spider|slurp|mediapartners|adsbot|google-inspectiontool|googleother|facebookexternalhit|meta-externalagent|whatsapp|telegrambot|twitterbot|linkedinbot|pinterest|embedly|bingpreview|lighthouse/i

export function isCrawler(userAgent: string | null | undefined): boolean {
  return !userAgent || CRAWLER.test(userAgent)
}

/** Cloudflare's CF-IPCountry: two letters, or XX (unknown) and T1 (Tor). */
export function visitorCountry(header: string | null | undefined) {
  const code = header?.trim().toUpperCase() ?? ""
  return /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : null
}

export function visitorPricing(
  pricing: StorefrontUsdPricing,
  visitor: { country: string | null; crawler: boolean },
): VisitorPricing {
  if (!pricing || visitor.crawler) {
    return { usd: null, suggested: "INR", country: visitor.country }
  }
  const own =
    visitor.country !== null
      ? pricing.countryUpliftBp[visitor.country]
      : undefined
  return {
    usd: {
      rateMicros: pricing.rateMicros,
      upliftBp: own ?? pricing.defaultUpliftBp,
    },
    suggested:
      visitor.country !== null && visitor.country !== "IN" ? "USD" : "INR",
    country: visitor.country,
  }
}

export function parseDisplayCurrency(
  value: string | null | undefined,
): Currency | null {
  return value === "INR" || value === "USD" ? value : null
}

/**
 * A dollar amount typed into the price filter, as the rupee list price it
 * matches (the filter searches rupee prices). Approximate by up to a dollar
 * because shown prices are rounded up to .99.
 */
export function usdCentsToListPaise(cents: number, pricing: UsdPricing) {
  return Math.round(
    (cents * pricing.rateMicros * 10_000) /
      (1_000_000 * (10_000 + pricing.upliftBp)),
  )
}

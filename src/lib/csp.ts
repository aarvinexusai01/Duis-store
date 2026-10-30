/**
 * The Content-Security-Policy header (doc/08 §2, owner decision 2026-10-21).
 * Sources are allow-listed; inline scripts stay allowed because cached page
 * shells carry Next's inline bootstrap scripts, and per-request nonces would
 * force every page to render on demand. React's escaping and the allow-list
 * rich-text renderer remain the main XSS defence.
 */

// Razorpay Checkout (script, frames, API calls, and the redirect form some
// banks need), per Razorpay's CSP guidance.
const RAZORPAY = "https://*.razorpay.com"
const GTAG = "https://www.googletagmanager.com"
const GA = ["https://*.google-analytics.com", "https://*.analytics.google.com"]
const META_SCRIPT = "https://connect.facebook.net"
const META_BEACON = "https://www.facebook.com"
const TURNSTILE = "https://challenges.cloudflare.com"
const INSTAGRAM = "https://www.instagram.com"
const YOUTUBE = "https://www.youtube-nocookie.com"

export type CspOptions = {
  /** `next dev` needs eval and its websocket. */
  dev: boolean
  /** Browser error reports go to the DSN's host. */
  sentryDsn?: string
  /** Images from ImageKit (Phase 10); its host is allowed for images. */
  imagekitEndpoint?: string
  /** Who may frame the page: nobody, or our own origin (CMS previews). */
  frameAncestors: "'none'" | "'self'"
}

function origin(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function contentSecurityPolicy(options: CspOptions): string {
  const sentry = origin(options.sentryDsn)
  const imagekit = origin(options.imagekitEndpoint)
  const directives: Record<string, (string | null | false)[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      options.dev && "'unsafe-eval'",
      RAZORPAY,
      GTAG,
      META_SCRIPT,
      TURNSTILE,
      INSTAGRAM,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      imagekit,
      RAZORPAY,
      GTAG,
      ...GA,
      META_BEACON,
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      options.dev && "ws:",
      RAZORPAY,
      GTAG,
      ...GA,
      META_BEACON,
      TURNSTILE,
      sentry,
    ],
    // 'self': the CMS editors show /preview/<token> in a frame (missing until
    // the first real server, where every admin preview stayed blank).
    "frame-src": ["'self'", RAZORPAY, YOUTUBE, INSTAGRAM, TURNSTILE],
    "media-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", RAZORPAY],
    "frame-ancestors": [options.frameAncestors],
  }
  return Object.entries(directives)
    .map(([name, sources]) =>
      [name, ...sources.filter((s): s is string => Boolean(s))].join(" "),
    )
    .join("; ")
}

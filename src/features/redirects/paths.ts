import { z } from "zod"

/**
 * Redirect paths (safe for the proxy, the client and the server). Matching
 * ignores case, a trailing slash and the query string, which is passed on.
 */
export function normalizePath(path: string): string {
  const bare = path.split(/[?#]/)[0]!.toLowerCase()
  const trimmed = bare.length > 1 ? bare.replace(/\/+$/, "") : bare
  return trimmed || "/"
}

// Paths the app owns outright: never redirected away.
const RESERVED =
  /^\/(api|admin|_next|media|photos|preview|auth|login|register|checkout|account)(\/|$)/

export const fromPathSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^\/[^?#\s]*$/, "Start with / and leave out ? and #.")
  .transform(normalizePath)
  .refine((path) => path !== "/", "The home page can't be redirected.")
  .refine(
    (path) => !RESERVED.test(path),
    "This part of the site can't be redirected.",
  )

export const toPathSchema = z
  .string()
  .trim()
  .max(500)
  .regex(
    /^(\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/,
    "Use a site path like /shop, or an https link.",
  )

export function isRedirectable(path: string): boolean {
  return !RESERVED.test(path)
}

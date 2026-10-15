/**
 * Post-login destination from a `next` parameter: same-site paths only, so
 * the login page can never bounce someone to another site.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/account",
): string {
  if (!next || next.length > 512) return fallback
  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return fallback
  }
  if (/[\u0000-\u001f]/.test(next)) return fallback
  if (next.startsWith("/api/") || next.startsWith("/auth/")) return fallback
  return next
}

/** Where every sign-in method lands: merges the guest bag, then `next`. */
export function completeSignInUrl(next: string): string {
  return `/auth/complete?next=${encodeURIComponent(safeNextPath(next))}`
}

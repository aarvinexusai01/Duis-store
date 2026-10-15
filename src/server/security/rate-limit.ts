import "server-only"

/**
 * Small fixed-window limiter for public GET endpoints, per process (so two
 * replicas allow up to twice the limit). Auth endpoints use Better Auth's
 * database-backed limiter instead; Cloudflare rules sit in front of both.
 */
export function createRateLimiter(options: {
  limit: number
  windowMs: number
}) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return function allow(key: string): boolean {
    const now = Date.now()
    if (hits.size > 10_000) {
      for (const [entryKey, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(entryKey)
      }
    }
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs })
      return true
    }
    entry.count += 1
    return entry.count <= options.limit
  }
}

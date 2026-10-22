import type { NextRequest } from "next/server"

import { getSuggestions } from "@/features/catalog/queries"
import { MIN_SUGGEST_LENGTH, normaliseSearchQuery } from "@/lib/search-query"
import { hitLimit, LIMITS } from "@/server/security/shared-rate-limit"

/** Header autocomplete: up to six products and four categories. */
export async function GET(request: NextRequest) {
  const query = normaliseSearchQuery(request.nextUrl.searchParams.get("q"))
  if (query.length < MIN_SUGGEST_LENGTH) {
    return Response.json({ products: [], categories: [] })
  }
  // Every keystroke can reach the database; a script typing for us can't
  // (doc/06 Phase 8 audit). Nginx sets X-Real-IP from Cloudflare's header.
  const ip = request.headers.get("x-real-ip") ?? "unknown"
  if (!(await hitLimit(`suggest:${ip}`, LIMITS.searchSuggest))) {
    return Response.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many searches. Try again in a minute.",
        },
      },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }
  const suggestions = await getSuggestions(query)
  return Response.json(suggestions, {
    headers: { "Cache-Control": "public, max-age=60" },
  })
}

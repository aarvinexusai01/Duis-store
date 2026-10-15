import type { NextRequest } from "next/server"

import { getSuggestions } from "@/features/catalog/queries"
import { MIN_SUGGEST_LENGTH, normaliseSearchQuery } from "@/lib/search-query"

/** Header autocomplete: up to six products and four categories. */
export async function GET(request: NextRequest) {
  const query = normaliseSearchQuery(request.nextUrl.searchParams.get("q"))
  if (query.length < MIN_SUGGEST_LENGTH) {
    return Response.json({ products: [], categories: [] })
  }
  const suggestions = await getSuggestions(query)
  return Response.json(suggestions, {
    headers: { "Cache-Control": "public, max-age=60" },
  })
}

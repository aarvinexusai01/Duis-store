import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { SearchBox } from "@/components/layout/search-box"
import { searchCatalog } from "@/features/catalog/queries"
import { ListingView } from "@/features/catalog/ui/listing-view"
import { parseListingParams } from "@/lib/listing-params"

// Result pages are endless query variations: never indexed.
export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Suspense fallback={<PageSkeleton variant="grid" />}>
      <Results searchParams={searchParams} />
    </Suspense>
  )
}

async function Results({
  searchParams,
}: Pick<PageProps<"/search">, "searchParams">) {
  await connection()
  const raw = await searchParams
  const query = (typeof raw.q === "string" ? raw.q : "").trim().slice(0, 100)
  if (!query) {
    return (
      <div className="page-container max-w-xl py-16">
        <h1 className="mb-6 display-heading text-5xl">Search</h1>
        <SearchBox autoFocus />
      </div>
    )
  }
  const params = parseListingParams(raw)
  // Elasticsearch, or Postgres while it's unavailable (ADR-0033).
  const listing = await searchCatalog(query, params)
  return (
    <ListingView
      title={`Results for “${query}”`}
      crumbs={[
        { label: "Search", href: `/search?q=${encodeURIComponent(query)}` },
      ]}
      basePath="/search"
      extraQuery={{ q: query }}
      params={params}
      listing={listing}
    />
  )
}

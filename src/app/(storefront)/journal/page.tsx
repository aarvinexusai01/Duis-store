import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { JournalListing } from "@/features/cms/ui/journal/listing"
import { pageOf } from "@/lib/admin-query"

export const metadata: Metadata = {
  title: "The Journal",
  description: "Stories, styling notes and the people behind the drops.",
  alternates: {
    canonical: "/journal",
    types: { "application/rss+xml": "/journal/rss.xml" },
  },
}

export default function JournalPage({ searchParams }: PageProps<"/journal">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Listing searchParams={searchParams} />
    </Suspense>
  )
}

async function Listing({
  searchParams,
}: Pick<PageProps<"/journal">, "searchParams">) {
  await connection()
  return (
    <JournalListing
      filter={{ kind: "all" }}
      page={pageOf(await searchParams)}
      basePath="/journal"
    />
  )
}

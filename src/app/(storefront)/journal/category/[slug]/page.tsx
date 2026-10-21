import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { getJournalTerm } from "@/features/cms/queries"
import { JournalListing } from "@/features/cms/ui/journal/listing"
import { pageOf } from "@/lib/admin-query"

type Props = PageProps<"/journal/category/[slug]">

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection()
  const { slug } = await params
  const term = await getJournalTerm("category", slug)
  if (!term) return { title: "Not found", robots: { index: false } }
  return {
    title: `${term.name} · The Journal`,
    description: term.description ?? undefined,
    alternates: { canonical: `/journal/category/${term.slug}` },
  }
}

export default function JournalCategoryPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Listing params={params} searchParams={searchParams} />
    </Suspense>
  )
}

async function Listing({ params, searchParams }: Props) {
  await connection()
  const { slug } = await params
  return (
    <JournalListing
      filter={{ kind: "category", slug }}
      page={pageOf(await searchParams)}
      basePath={`/journal/category/${slug}`}
    />
  )
}

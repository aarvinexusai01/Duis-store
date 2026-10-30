import type { Metadata, Route } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { Suspense } from "react"

import { Breadcrumbs } from "@/components/breadcrumbs"
import { MediaImage } from "@/components/media-image"
import { PageSkeleton } from "@/components/page-skeleton"
import { getPublishedCollections } from "@/features/collections/queries"

export const metadata: Metadata = {
  title: "Collections — Men's Streetwear Drops & Edits",
  description:
    "Every Duis drop and edit in one place: best sellers, new arrivals and seasonal edits of oversized tees, shirts, hoodies and sweatshirts for men.",
  alternates: { canonical: "/collections" },
}

export default function CollectionsPage() {
  return (
    <div className="page-container py-6">
      <Suspense fallback={<PageSkeleton variant="grid" />}>
        <Collections />
      </Suspense>
    </div>
  )
}

async function Collections() {
  await connection()
  const collections = await getPublishedCollections()
  return (
    <>
      <Breadcrumbs items={[{ label: "Collections", href: "/collections" }]} />
      <h1 className="mt-6 mb-8 display-heading text-5xl sm:text-6xl">
        Collections
      </h1>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((collection, index) => (
          <li key={collection.id}>
            <Link
              href={`/collections/${collection.slug}` as Route}
              className="group relative block aspect-[4/3] overflow-hidden bg-ink"
            >
              {(collection.image ?? collection.banner) && (
                <MediaImage
                  media={(collection.image ?? collection.banner)!}
                  alt=""
                  fill
                  preload={index < 3}
                  sizes="(min-width: 1024px) 31vw, (min-width: 640px) 48vw, 100vw"
                  className="object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
                />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/85 to-transparent p-5">
                <span className="block font-display text-3xl tracking-wide text-paper uppercase">
                  {collection.title}
                </span>
                {collection.description && (
                  <span className="mt-1 line-clamp-2 block text-sm text-chrome-muted">
                    {collection.description}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

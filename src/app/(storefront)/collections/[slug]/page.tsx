import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { getListing } from "@/features/catalog/queries"
import { listingMetadata } from "@/features/catalog/ui/listing-metadata"
import { ListingView } from "@/features/catalog/ui/listing-view"
import { getCollectionBySlug } from "@/features/collections/queries"
import { getStorePolicy } from "@/features/settings"
import { EMPTY_PARAMS, parseListingParams } from "@/lib/listing-params"
import { fitDescription, fitTitle, rupees, storePromises } from "@/lib/seo"
import { SLUG } from "@/lib/slug"

type Props = PageProps<"/collections/[slug]">

async function load(props: Pick<Props, "params" | "searchParams">) {
  await connection()
  const [{ slug }, search] = await Promise.all([
    props.params,
    props.searchParams,
  ])
  const collection = SLUG.test(slug) ? await getCollectionBySlug(slug) : null
  return { collection, params: parseListingParams(search) }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { collection, params } = await load(props)
  if (!collection) return { title: "Not found", robots: { index: false } }
  const [listing, policy] = await Promise.all([
    getListing(
      { kind: "collection", collectionId: collection.id },
      EMPTY_PARAMS,
    ),
    getStorePolicy(),
  ])
  const range = listing.priceRange
    ? ` ${listing.total} ${listing.total === 1 ? "style" : "styles"} from ${rupees(listing.priceRange.minPaise)}.`
    : ""
  return listingMetadata({
    title:
      collection.seoTitle ??
      fitTitle(
        `${collection.title} — Men's Streetwear Online in India`,
        `${collection.title} — Men's Streetwear`,
        collection.title,
      ),
    description:
      collection.seoDescription ??
      fitDescription(
        `${collection.description ? `${collection.description} ` : `Shop the Duis ${collection.title} edit.`}${range} ${storePromises(policy)}`,
      ),
    basePath: `/collections/${collection.slug}`,
    params,
    noindex: collection.noindex,
  })
}

export default function CollectionPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton variant="grid" />}>
      <Collection params={props.params} searchParams={props.searchParams} />
    </Suspense>
  )
}

async function Collection(props: Pick<Props, "params" | "searchParams">) {
  const { collection, params } = await load(props)
  if (!collection) notFound()
  const basePath = `/collections/${collection.slug}`
  const listing = await getListing(
    { kind: "collection", collectionId: collection.id },
    params,
  )
  return (
    <ListingView
      title={collection.title}
      description={collection.description}
      crumbs={[
        { label: "Collections", href: "/collections" },
        { label: collection.title, href: basePath },
      ]}
      basePath={basePath}
      params={params}
      listing={listing}
    />
  )
}

import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import type { CatalogTree, ShopLocation } from "@/features/catalog"
import { resolveShopLocation } from "@/features/catalog"
import { getCatalogTree, getListing } from "@/features/catalog/queries"
import { listingMetadata } from "@/features/catalog/ui/listing-metadata"
import { ListingView } from "@/features/catalog/ui/listing-view"
import { getStorePolicy } from "@/features/settings"
import { EMPTY_PARAMS, parseListingParams } from "@/lib/listing-params"
import { fitDescription, fitTitle, rupees, storePromises } from "@/lib/seo"

type Props = PageProps<"/shop/[[...slug]]">

async function locate(props: Pick<Props, "params" | "searchParams">) {
  await connection()
  const [{ slug = [] }, search, tree] = await Promise.all([
    props.params,
    props.searchParams,
    getCatalogTree(),
  ])
  const location = resolveShopLocation(tree, slug)
  return { location, params: parseListingParams(search), tree }
}

/** Every shop page's trail starts at /shop, which also gives it inbound links. */
const SHOP_CRUMB = { label: "Shop", href: "/shop" }

function describe(location: ShopLocation, tree: CatalogTree) {
  switch (location.kind) {
    case "all":
      return {
        title: "Shop all",
        description: null,
        basePath: "/shop",
        scope: { kind: "all" as const },
        crumbs: [SHOP_CRUMB],
        subcategories: tree.departments.map((d) => ({
          name: d.name,
          href: d.href,
        })),
        noindex: false,
      }
    case "department":
      return {
        title: location.department.name,
        description: null,
        basePath: location.department.href,
        scope: {
          kind: "department" as const,
          departmentSlug: location.department.slug,
        },
        crumbs: [
          SHOP_CRUMB,
          { label: location.department.name, href: location.department.href },
        ],
        subcategories: tree.categories
          .filter(
            (c) =>
              c.departmentSlug === location.department.slug &&
              c.parentId === null,
          )
          .map((c) => ({ name: c.name, href: c.href })),
        noindex: false,
      }
    case "category": {
      const category = location.category
      return {
        title: category.name,
        seoTitle: category.seoTitle,
        description: category.seoDescription ?? category.description,
        basePath: category.href,
        scope: { kind: "category" as const, categoryPath: category.path },
        crumbs: [
          SHOP_CRUMB,
          { label: location.department.name, href: location.department.href },
          ...location.trail.map((c) => ({ label: c.name, href: c.href })),
        ],
        subcategories: tree.categories
          .filter((c) => c.parentId === category.id)
          .map((c) => ({ name: c.name, href: c.href })),
        noindex: category.noindex,
      }
    }
  }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { location, params, tree } = await locate(props)
  if (!location) return { title: "Not found", robots: { index: false } }
  const view = describe(location, tree)
  // Staff's own SEO fields win; otherwise titles and descriptions are built
  // from the category, its real range and the store's promises (Phase 11).
  const [listing, policy] = await Promise.all([
    getListing(view.scope, EMPTY_PARAMS),
    getStorePolicy(),
  ])
  const audience = location.kind === "all" ? null : location.department.name
  const title =
    location.kind === "all"
      ? fitTitle("Shop All Streetwear — Tees, Shirts & Hoodies", "Shop all")
      : location.kind === "department"
        ? fitTitle(
            `${view.title}'s Clothing — Tees, Shirts & Hoodies`,
            `${view.title}'s Clothing`,
          )
        : fitTitle(
            `${view.title} for ${audience} — Buy Online in India`,
            `${view.title} for ${audience} — Shop Online`,
            `${view.title} for ${audience}`,
            view.title,
          )
  const range = listing.priceRange
    ? `${listing.total} ${listing.total === 1 ? "style" : "styles"} from ${rupees(listing.priceRange.minPaise)}`
    : "new styles"
  const subject =
    location.kind === "all"
      ? "streetwear"
      : `${view.title.toLowerCase()}${location.kind === "category" ? ` for ${audience!.toLowerCase()}` : "'s clothing"}`
  return listingMetadata({
    title: ("seoTitle" in view && view.seoTitle) || title,
    description:
      view.description ??
      fitDescription(
        `Shop ${subject} at Duis: ${range}. ${storePromises(policy)}`,
      ),
    basePath: view.basePath,
    params,
    noindex: view.noindex,
  })
}

export default function ShopPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton variant="grid" />}>
      <Shop params={props.params} searchParams={props.searchParams} />
    </Suspense>
  )
}

async function Shop(props: Pick<Props, "params" | "searchParams">) {
  const { location, params, tree } = await locate(props)
  if (!location) notFound()
  const view = describe(location, tree)
  const listing = await getListing(view.scope, params)
  return (
    <ListingView
      title={view.title}
      description={view.description}
      crumbs={view.crumbs}
      basePath={view.basePath}
      params={params}
      listing={listing}
      subcategories={view.subcategories}
    />
  )
}

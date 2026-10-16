import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { Suspense } from "react"

import { SectionHeading } from "@/components/brand/section-heading"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { JsonLd } from "@/components/json-ld"
import { PageSkeleton } from "@/components/page-skeleton"
import { ProductRail } from "@/components/product/product-card"
import { RichText } from "@/components/rich-text"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { STORE_POLICY } from "@/config/store-policy"
import type { CatalogTree, ProductDetail } from "@/features/catalog"
import {
  getCatalogTree,
  getProductDetail,
  getRelatedProducts,
} from "@/features/catalog/queries"
import { getAvailability } from "@/features/inventory"
import { WishlistButton } from "@/features/wishlist/ui/wishlist-button"
import { countryName } from "@/lib/countries"
import { formatPaise } from "@/lib/money"
import { SLUG } from "@/lib/slug"
import type { Stock } from "@/lib/variant-selection"
import { anonymousActor } from "@/server/auth/actor"
import { absoluteUrl } from "@/server/site-url"

import { PincodeCheck } from "./_components/pincode-check"
import { ProductView } from "./_components/product-view"
import { SizeGuide } from "./_components/size-guide"

type Props = PageProps<"/products/[slug]">

async function load(params: Props["params"]) {
  await connection()
  const { slug } = await params
  return SLUG.test(slug) ? getProductDetail(slug) : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await load(params)
  if (!product) return { title: "Product not found", robots: { index: false } }
  const image = product.media[0]
  return {
    title: product.seoTitle ?? product.title,
    description:
      product.seoDescription ??
      (product.descriptionText.slice(0, 160) || undefined),
    alternates: { canonical: `/products/${product.slug}` },
    robots: product.noindex ? { index: false, follow: true } : undefined,
    openGraph: image
      ? {
          images: [
            {
              url: `/media/${image.key}/1280.webp`,
              width: 1280,
              alt: image.alt,
            },
          ],
        }
      : undefined,
  }
}

export default function ProductPage({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton variant="product" />}>
      <Product params={params} />
    </Suspense>
  )
}

/** Stock is read fresh on every request and never cached (doc/06, Phase 2). */
async function loadStock(variantIds: string[]): Promise<Stock> {
  if (variantIds.length === 0) return {}
  try {
    return Object.fromEntries(
      await getAvailability(anonymousActor(), { variantIds }),
    )
  } catch {
    return null
  }
}

async function Product({ params }: Pick<Props, "params">) {
  const product = await load(params)
  if (!product) notFound()
  const tree = await getCatalogTree()
  const stock = loadStock(product.variants.map((variant) => variant.id))

  return (
    <div className="page-container py-6">
      <Breadcrumbs
        items={[
          ...categoryTrail(tree, product.primaryCategoryId),
          { label: product.title, href: `/products/${product.slug}` },
        ]}
      />
      <div className="mt-6">
        <ProductView
          product={product}
          stock={stock}
          sizeGuide={
            product.sizeChart && <SizeGuide chart={product.sizeChart} />
          }
          wishlist={
            <WishlistButton
              productId={product.id}
              productTitle={product.title}
              className="size-12 shrink-0 rounded-none border border-ink bg-transparent shadow-none"
            />
          }
        >
          <div className="mt-8 flex flex-col gap-6">
            <PincodeCheck />
            <ul className="space-y-1 text-sm">
              <li>
                Free shipping in India on orders over{" "}
                {formatPaise(STORE_POLICY.freeShippingThresholdPaise)}
              </li>
              <li>
                Size or colour exchange within {STORE_POLICY.exchangeWindowDays}{" "}
                days of delivery, free pickup
              </li>
              <li>
                Cash on delivery in India up to{" "}
                {formatPaise(STORE_POLICY.codMaxOrderPaise)} (
                {formatPaise(STORE_POLICY.codAdvancePaise)} paid online)
              </li>
            </ul>
            <ProductDetails product={product} />
          </div>
        </ProductView>
      </div>

      <Suspense fallback={null}>
        <Related productId={product.id} />
      </Suspense>
      <Suspense fallback={null}>
        <ProductStructuredData product={product} tree={tree} stock={stock} />
      </Suspense>
    </div>
  )
}

function categoryTrail(tree: CatalogTree, categoryId: string | null) {
  const category = tree.categories.find((c) => c.id === categoryId)
  if (!category) return []
  const department = tree.departments.find(
    (d) => d.slug === category.departmentSlug,
  )
  const ancestors = tree.categories
    .filter(
      (c) => category.path.startsWith(`${c.path}.`) || c.id === category.id,
    )
    .sort((a, b) => a.depth - b.depth)
  return [
    ...(department ? [{ label: department.name, href: department.href }] : []),
    ...ancestors.map((c) => ({ label: c.name, href: c.href })),
  ]
}

function ProductDetails({ product }: { product: ProductDetail }) {
  const specs = [
    ...product.descriptiveValues.map((value) => ({
      label: value.code.replace(/^\w/, (c) => c.toUpperCase()),
      value: value.label,
    })),
    ...product.specifications,
    ...(product.material
      ? [{ label: "Material", value: product.material }]
      : []),
  ]
  return (
    <Accordion defaultValue={["description"]} className="border-t">
      <AccordionItem value="description">
        <AccordionTrigger className="py-4 text-sm font-semibold tracking-wide uppercase">
          Description
        </AccordionTrigger>
        <AccordionContent>
          {product.description ? (
            <RichText document={product.description} className="pb-4" />
          ) : (
            <p className="pb-4">{product.descriptionText}</p>
          )}
        </AccordionContent>
      </AccordionItem>
      {specs.length > 0 && (
        <AccordionItem value="specs">
          <AccordionTrigger className="py-4 text-sm font-semibold tracking-wide uppercase">
            Specifications
          </AccordionTrigger>
          <AccordionContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pb-4">
              {specs.map((spec) => (
                <div key={`${spec.label}-${spec.value}`} className="contents">
                  <dt className="text-muted-foreground">{spec.label}</dt>
                  <dd>{spec.value}</dd>
                </div>
              ))}
            </dl>
            {product.care && <p className="pb-4">Care: {product.care}</p>}
          </AccordionContent>
        </AccordionItem>
      )}
      <AccordionItem value="legal">
        <AccordionTrigger className="py-4 text-sm font-semibold tracking-wide uppercase">
          Product details
        </AccordionTrigger>
        <AccordionContent>
          {/* Declarations required by the Legal Metrology (Packaged Commodities) Rules. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pb-4">
            <dt className="text-muted-foreground">Country of origin</dt>
            <dd>{countryName(product.countryOfOrigin)}</dd>
            <dt className="text-muted-foreground">Manufacturer</dt>
            <dd className="whitespace-pre-line">
              {product.manufacturerDetails}
            </dd>
            <dt className="text-muted-foreground">Net quantity</dt>
            <dd>{product.netQuantity}</dd>
            <dt className="text-muted-foreground">MRP</dt>
            <dd>Inclusive of all taxes</dd>
          </dl>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

async function Related({ productId }: { productId: string }) {
  const products = await getRelatedProducts(productId)
  if (products.length === 0) return null
  return (
    <section className="mt-16">
      <SectionHeading title="You may also like" />
      <ProductRail products={products} label="You may also like" />
    </section>
  )
}

async function ProductStructuredData({
  product,
  tree,
  stock,
}: {
  product: ProductDetail
  tree: CatalogTree
  stock: Promise<Stock>
}) {
  const live = await stock
  const url = absoluteUrl(`/products/${product.slug}`)
  const category = tree.categories.find(
    (c) => c.id === product.primaryCategoryId,
  )
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "ProductGroup",
        name: product.title,
        description: product.descriptionText || undefined,
        url,
        productGroupID: product.id,
        brand: { "@type": "Brand", name: "Duis" },
        category: category?.name,
        countryOfOrigin: product.countryOfOrigin,
        image: product.media
          .slice(0, 6)
          .map((m) => absoluteUrl(`/media/${m.key}/1280.webp`)),
        variesBy: product.axes.map((axis) =>
          axis.code === "color"
            ? "https://schema.org/color"
            : axis.code === "size"
              ? "https://schema.org/size"
              : axis.name,
        ),
        hasVariant: product.variants.map((variant) => ({
          "@type": "Product",
          sku: variant.sku,
          name: `${product.title} — ${Object.values(variant.options).join(" / ")}`,
          ...(variant.options.color ? { color: variant.options.color } : {}),
          ...(variant.options.size
            ? { size: variant.options.size.toUpperCase() }
            : {}),
          offers: {
            "@type": "Offer",
            url: `${url}?${new URLSearchParams(variant.options)}`,
            priceCurrency: "INR",
            price: (variant.pricePaise / 100).toFixed(2),
            itemCondition: "https://schema.org/NewCondition",
            ...(live
              ? {
                  availability:
                    (live[variant.id] ?? 0) > 0
                      ? "https://schema.org/InStock"
                      : "https://schema.org/OutOfStock",
                }
              : {}),
          },
        })),
      }}
    />
  )
}

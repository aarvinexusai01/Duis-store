import type { Route } from "next"
import Link from "next/link"

import { Price } from "@/components/brand/price"
import { MediaImage } from "@/components/media-image"
import type { ProductCard as ProductCardData } from "@/features/catalog"
import { WishlistButton } from "@/features/wishlist/ui/wishlist-button"
import { cn } from "@/lib/utils"

const DEFAULT_SIZES = "(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"

export function ProductCard({
  product,
  preload = false,
  sizes = DEFAULT_SIZES,
  headingLevel = 3,
  className,
}: {
  product: ProductCardData
  /** h2 directly under a page's h1 (listings), h3 under a section heading. */
  headingLevel?: 2 | 3
  /** Above-the-fold cards (first row of a listing) load eagerly. */
  preload?: boolean
  sizes?: string
  className?: string
}) {
  const href = `/products/${product.slug}` as Route
  const colours = product.colours
  const Title = headingLevel === 2 ? "h2" : "h3"
  return (
    <article className={cn("group/card relative", className)}>
      <Link href={href} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
          {product.image ? (
            <MediaImage
              media={product.image}
              // The title below names the product; the image is decorative here.
              alt=""
              fill
              sizes={sizes}
              preload={preload}
              className={cn(
                "object-cover transition-opacity duration-300",
                product.hoverImage && "group-hover/card:opacity-0",
              )}
            />
          ) : null}
          {product.hoverImage && (
            <MediaImage
              media={product.hoverImage}
              alt=""
              fill
              sizes={sizes}
              className="object-cover opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
            />
          )}
          {product.discountPercent > 0 && product.inStock && (
            <span className="absolute top-2 left-2 bg-rust px-1.5 py-0.5 text-[0.6875rem] font-bold text-rust-foreground uppercase">
              {product.discountPercent}% off
            </span>
          )}
          {!product.inStock && (
            <span className="absolute inset-x-0 bottom-0 bg-ink/85 py-1.5 text-center text-xs font-semibold tracking-wider text-paper uppercase">
              Sold out
            </span>
          )}
        </div>
        <Title className="mt-3 line-clamp-1 text-sm font-medium">
          {product.title}
        </Title>
        <Price
          className="mt-1"
          pricePaise={product.pricePaise}
          mrpPaise={product.mrpPaise}
          from={product.maxPricePaise > product.pricePaise}
        />
        {colours.length > 1 && (
          <p className="mt-2 flex items-center gap-1.5">
            {colours.slice(0, 5).map((colour) => (
              <span
                key={colour.slug}
                aria-hidden
                title={colour.label}
                className="size-3 rounded-full border border-ink/20"
                style={{ backgroundColor: colour.hex ?? "transparent" }}
              />
            ))}
            <span className="text-xs text-muted-foreground">
              {colours.length > 5 && `+${colours.length - 5} `}
              <span className="sr-only">
                Available in {colours.length} colours:{" "}
                {colours.map((c) => c.label).join(", ")}
              </span>
            </span>
          </p>
        )}
      </Link>
      <WishlistButton
        productId={product.id}
        productTitle={product.title}
        className="absolute top-2 right-2"
      />
    </article>
  )
}

export function ProductGrid({
  products,
  preloadFirst = 0,
  headingLevel = 2,
}: {
  products: ProductCardData[]
  preloadFirst?: number
  headingLevel?: 2 | 3
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 md:gap-x-5 xl:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            preload={index < preloadFirst}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  )
}

/** Horizontally scrolling row (scroll-snap, no carousel script). */
export function ProductRail({
  products,
  label = "Products",
}: {
  products: ProductCardData[]
  label?: string
}) {
  return (
    <ul
      aria-label={label}
      // A horizontal scroller must be reachable by keyboard.
      tabIndex={0}
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:-mx-8 md:scroll-px-8 md:gap-5 md:px-8"
    >
      {products.map((product) => (
        <li
          key={product.id}
          className="w-[44vw] shrink-0 snap-start md:w-[28vw] lg:w-[21vw] xl:w-[18rem]"
        >
          <ProductCard
            product={product}
            sizes="(min-width: 1280px) 288px, (min-width: 1024px) 21vw, (min-width: 768px) 28vw, 44vw"
          />
        </li>
      ))}
    </ul>
  )
}

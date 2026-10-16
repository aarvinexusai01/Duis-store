import type { Route } from "next"
import Link from "next/link"

import { SectionHeading } from "@/components/brand/section-heading"
import { MediaImage } from "@/components/media-image"
import { ProductRail } from "@/components/product/product-card"
import { RichText } from "@/components/rich-text"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { buttonVariants } from "@/components/ui/button"
import { NewsletterForm } from "@/components/newsletter-form"
import { cn } from "@/lib/utils"

import type { ResolvedBlock } from "../resolve"
import { BannerImage } from "./hero-image"

type Of<T extends ResolvedBlock["type"]> = Extract<ResolvedBlock, { type: T }>

/** Storefront renderer for every block type (doc/04 §4). */
export function Blocks({
  blocks,
  startIndex = 0,
}: {
  blocks: ResolvedBlock[]
  /** Position of `blocks[0]` on the page; only the page's first block preloads. */
  startIndex?: number
}) {
  return blocks.map((block, index) => (
    <BlockView key={block.id} block={block} first={startIndex + index === 0} />
  ))
}

function BlockView({ block, first }: { block: ResolvedBlock; first: boolean }) {
  switch (block.type) {
    case "hero_banner":
    case "promo_slider":
      return <Slides block={block} first={first} />
    case "announcement":
      return <Announcement block={block} />
    case "category_showcase":
      return <CategoryShowcase block={block} />
    case "featured_collections":
      return <FeaturedCollections block={block} />
    case "product_rail":
      return (
        <section className="page-container py-10">
          <SectionHeading
            title={block.heading}
            href={block.cta?.href}
            linkLabel={block.cta?.label}
          />
          <ProductRail products={block.products} label={block.heading} />
        </section>
      )
    case "promo_banner_grid":
      return <PromoGrid block={block} />
    case "rich_text":
      return (
        <section className="page-container max-w-3xl py-10">
          <RichText document={block.content} />
        </section>
      )
    case "brand_story":
      return <BrandStory block={block} />
    case "newsletter":
      return (
        <section className="page-container py-12">
          <div className="flex flex-col items-start gap-4 border-2 border-ink bg-card p-6 sm:p-10 md:flex-row md:items-center md:justify-between">
            <div className="max-w-md">
              <h2 className="display-heading text-3xl sm:text-4xl">
                {block.heading}
              </h2>
              {block.subheading && (
                <p className="mt-2 text-muted-foreground">{block.subheading}</p>
              )}
            </div>
            <NewsletterForm source="home" tone="light" />
          </div>
        </section>
      )
    case "faq_list":
      return (
        <section className="page-container max-w-3xl py-10">
          <h2 className="mb-4 display-heading text-3xl sm:text-4xl">
            {block.heading}
          </h2>
          <Accordion>
            {block.items.map((item, index) => (
              <AccordionItem key={index} value={String(index)}>
                <AccordionTrigger className="py-4 text-base font-semibold">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent>
                  <RichText document={item.answer} className="pb-4" />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )
    case "image_with_text":
      return <ImageWithText block={block} />
  }
}

function Cta({
  cta,
  tone = "dark",
}: {
  cta: { label: string; href: string }
  tone?: "dark" | "light"
}) {
  return (
    <Link
      href={cta.href as Route}
      className={cn(
        buttonVariants({ size: "lg" }),
        "h-12 rounded-none px-7 text-sm font-semibold tracking-wider uppercase",
        tone === "light" && "bg-paper text-ink hover:bg-paper/90",
      )}
    >
      {cta.label}
    </Link>
  )
}

function Slides({
  block,
  first,
}: {
  block: Of<"hero_banner" | "promo_slider">
  first: boolean
}) {
  const hero = block.type === "hero_banner"
  const many = block.slides.length > 1
  return (
    <section
      aria-roledescription={many ? "carousel" : undefined}
      aria-label={hero ? "Featured" : "Promotions"}
      className={cn(!hero && "page-container py-8")}
    >
      <ul
        tabIndex={many ? 0 : undefined}
        className={cn(
          many && "flex snap-x snap-mandatory overflow-x-auto",
          !hero && "gap-4",
        )}
      >
        {block.slides.map((slide, index) => (
          <li
            key={index}
            aria-roledescription={many ? "slide" : undefined}
            aria-label={
              many ? `${index + 1} of ${block.slides.length}` : undefined
            }
            className={cn(
              "relative w-full shrink-0 snap-start overflow-hidden bg-ink",
              hero
                ? "aspect-[4/5] sm:aspect-[16/9] lg:aspect-[21/9]"
                : "aspect-[2/1]",
            )}
          >
            <BannerImage
              image={slide.image}
              mobileImage={hero ? slide.mobileImage : null}
              preload={first && index === 0}
              className="absolute inset-0 size-full object-cover"
            />
            {(slide.heading || slide.cta) && (
              <div
                className={cn(
                  "absolute inset-0 flex flex-col justify-end gap-4 p-6 sm:p-10 lg:p-16",
                  slide.textTone === "light"
                    ? "bg-gradient-to-t from-ink/70 via-ink/20 to-transparent text-paper"
                    : "bg-gradient-to-t from-paper/70 via-paper/10 to-transparent text-ink",
                )}
              >
                {slide.heading &&
                  (hero && index === 0 ? (
                    <h1 className="max-w-3xl display-heading text-5xl sm:text-7xl lg:text-8xl">
                      {slide.heading}
                    </h1>
                  ) : (
                    <h2 className="max-w-3xl display-heading text-4xl sm:text-6xl">
                      {slide.heading}
                    </h2>
                  ))}
                {slide.subheading && (
                  <p className="max-w-xl text-base sm:text-lg">
                    {slide.subheading}
                  </p>
                )}
                {slide.cta && (
                  <div>
                    <Cta
                      cta={slide.cta}
                      tone={slide.textTone === "light" ? "light" : "dark"}
                    />
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Announcement({ block }: { block: Of<"announcement"> }) {
  const text = (
    <p className="font-display text-xl tracking-wide uppercase sm:text-2xl">
      {block.text}
    </p>
  )
  return (
    <section className="bg-mustard py-4 text-center text-ink">
      <div className="page-container">
        {block.href ? (
          <Link href={block.href as Route} className="hover:underline">
            {text}
          </Link>
        ) : (
          text
        )}
      </div>
    </section>
  )
}

function CategoryShowcase({ block }: { block: Of<"category_showcase"> }) {
  return (
    <section className="page-container py-10">
      <SectionHeading title={block.heading} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-5 lg:grid-cols-6">
        {block.categories.map((category) => (
          <li key={category.href}>
            <Link href={category.href as Route} className="group block">
              <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
                {category.image && (
                  <MediaImage
                    media={category.image}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 16vw, (min-width: 640px) 31vw, 46vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
              </div>
              <p className="mt-2 text-sm font-semibold tracking-wide uppercase group-hover:text-rust">
                {category.name}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FeaturedCollections({ block }: { block: Of<"featured_collections"> }) {
  const banner = block.layout === "banner"
  return (
    <section className="page-container py-10">
      <SectionHeading title={block.heading} href="/collections" />
      <ul
        tabIndex={block.layout === "carousel" ? 0 : undefined}
        className={cn(
          "grid gap-3 md:gap-5",
          banner ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-4",
          block.layout === "carousel" &&
            "-mx-4 flex snap-x overflow-x-auto px-4 md:-mx-8 md:px-8",
        )}
      >
        {block.collections.map((collection) => {
          const image = banner
            ? (collection.banner ?? collection.image)
            : collection.image
          return (
            <li
              key={collection.id}
              className={cn(
                block.layout === "carousel" &&
                  "w-[70vw] shrink-0 snap-start sm:w-[40vw] lg:w-[24rem]",
              )}
            >
              <Link
                href={`/collections/${collection.slug}` as Route}
                className="group relative block overflow-hidden bg-ink"
              >
                <div
                  className={cn(
                    "relative",
                    banner ? "aspect-[21/9]" : "aspect-square",
                  )}
                >
                  {image && (
                    <MediaImage
                      media={image}
                      alt=""
                      fill
                      sizes={
                        banner ? "100vw" : "(min-width: 1024px) 24vw, 48vw"
                      }
                      className="object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                </div>
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-4 font-display text-2xl tracking-wide text-paper uppercase sm:text-3xl">
                  {collection.title}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PromoGrid({ block }: { block: Of<"promo_banner_grid"> }) {
  return (
    <section className="page-container py-10">
      <ul
        className={cn(
          "grid gap-3 md:gap-5",
          block.banners.length > 1 && "md:grid-cols-2",
          block.banners.length > 2 && "lg:grid-cols-3",
        )}
      >
        {block.banners.map((banner, index) => (
          <li key={index}>
            <Link
              href={banner.href as Route}
              className="group relative block aspect-[16/9] overflow-hidden bg-ink"
            >
              <MediaImage
                media={banner.image}
                alt={banner.heading ? "" : banner.image.alt}
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              {banner.heading && (
                <span className="absolute bottom-4 left-4 bg-paper px-3 py-2 font-display text-xl tracking-wide text-ink uppercase sm:text-2xl">
                  {banner.heading}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function BrandStory({ block }: { block: Of<"brand_story"> }) {
  return (
    <section className="my-10 bg-ink text-paper">
      <div className="page-container grid items-center gap-8 py-14 md:grid-cols-2 lg:py-20">
        {block.image && (
          <div className="relative aspect-[4/3] overflow-hidden">
            <MediaImage
              media={block.image}
              fill
              sizes="(min-width: 768px) 45vw, 100vw"
              className="object-cover"
            />
          </div>
        )}
        <div className={cn(!block.image && "md:col-span-2 md:max-w-2xl")}>
          <h2 className="display-heading text-4xl sm:text-6xl">
            {block.heading}
          </h2>
          <RichText
            document={block.content}
            className="mt-5 text-chrome-muted [&_a]:text-paper"
          />
          {block.cta && (
            <div className="mt-6">
              <Cta cta={block.cta} tone="light" />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function ImageWithText({ block }: { block: Of<"image_with_text"> }) {
  return (
    <section className="page-container grid items-center gap-8 py-10 md:grid-cols-2">
      <div
        className={cn(
          "relative aspect-[4/3] overflow-hidden bg-secondary",
          block.imagePosition === "right" && "md:order-2",
        )}
      >
        <MediaImage
          media={block.image}
          fill
          sizes="(min-width: 768px) 45vw, 100vw"
          className="object-cover"
        />
      </div>
      <div>
        <h2 className="display-heading text-4xl sm:text-5xl">
          {block.heading}
        </h2>
        <RichText document={block.content} className="mt-4" />
        {block.cta && (
          <div className="mt-6">
            <Cta cta={block.cta} />
          </div>
        )}
      </div>
    </section>
  )
}

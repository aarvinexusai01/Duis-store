import { ProductCard } from "@/components/product/product-card"
import { MediaImage } from "@/components/media-image"
import { RichText } from "@/components/rich-text"
import { cn } from "@/lib/utils"

import type { ResolvedPostBlock } from "@/features/cms/journal"
import { InstagramEmbed } from "@/components/instagram-embed"
import { YouTubeEmbed } from "./youtube-embed"

const COLUMNS: Record<number, string> = {
  1: "max-w-xs grid-cols-1",
  2: "max-w-2xl",
  3: "max-w-4xl md:grid-cols-3",
  4: "max-w-6xl md:grid-cols-4",
}

/** A post's blocks with the storefront's own components. */
export function PostBody({ blocks }: { blocks: ResolvedPostBlock[] }) {
  return (
    <div>
      {blocks.map((block) => {
        switch (block.type) {
          case "text":
            return (
              <RichText
                key={block.id}
                document={block.content}
                className="mx-auto max-w-2xl text-lg leading-relaxed"
              />
            )
          case "image":
            return (
              <figure key={block.id} className="mx-auto my-8 max-w-3xl">
                <MediaImage
                  media={block.image}
                  sizes="(min-width: 768px) 768px, 100vw"
                  className="h-auto w-full"
                />
                {block.caption && (
                  <figcaption className="mt-2 text-center text-sm text-muted-foreground">
                    {block.caption}
                  </figcaption>
                )}
              </figure>
            )
          case "products":
            return (
              <section
                key={block.id}
                className="my-10"
                aria-label={block.heading ?? "Shop the post"}
              >
                <h2 className="mb-4 text-center font-display text-2xl tracking-wide uppercase">
                  {block.heading ?? "Shop the post"}
                </h2>
                {/* Centred, with as many columns as products (up to four). */}
                <ul
                  className={cn(
                    "mx-auto grid grid-cols-2 gap-x-3 gap-y-8 md:gap-x-5",
                    COLUMNS[Math.min(block.products.length, 4)],
                  )}
                >
                  {block.products.map((product) => (
                    <li key={product.id}>
                      <ProductCard product={product} headingLevel={3} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          case "youtube":
            return (
              <div key={block.id} className="mx-auto max-w-3xl">
                <YouTubeEmbed videoId={block.videoId} title={block.title} />
              </div>
            )
          case "instagram":
            return <InstagramEmbed key={block.id} url={block.url} />
        }
      })}
    </div>
  )
}

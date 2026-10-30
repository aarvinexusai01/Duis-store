import type { MediaRef } from "@/features/catalog"
import { mediaSrc } from "@/lib/image-loader"
import { cn } from "@/lib/utils"

// Cards never render wider than ~300 CSS px (≈900 device px at 3x), so the
// three smaller renditions are enough.
const CARD_WIDTHS = [320, 640, 960] as const

/**
 * A lean <img> for product cards. A page can carry dozens of cards, and each
 * next/image adds a five-entry srcset and an inline style to both the HTML
 * and the RSC payload (ADR-020).
 */
export function CardImage({
  media,
  sizes,
  preload = false,
  alt = "",
  className,
}: {
  media: MediaRef
  /** The product's name for its main photo (Google Images); "" for duplicates. */
  alt?: string
  sizes: string
  preload?: boolean
  className?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- renditions are pre-generated; see the doc comment
    <img
      src={mediaSrc(media.key, 640)}
      srcSet={CARD_WIDTHS.map((w) => `${mediaSrc(media.key, w)} ${w}w`).join(
        ", ",
      )}
      sizes={sizes}
      width={media.width}
      height={media.height}
      alt={alt}
      loading={preload ? "eager" : "lazy"}
      fetchPriority={preload ? "high" : undefined}
      decoding="async"
      className={cn("absolute inset-0 size-full object-cover", className)}
    />
  )
}

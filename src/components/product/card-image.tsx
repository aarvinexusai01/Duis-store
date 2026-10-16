import type { MediaRef } from "@/features/catalog"
import { MEDIA_PREFIX } from "@/lib/image-loader"
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
  className,
}: {
  media: MediaRef
  sizes: string
  preload?: boolean
  className?: string
}) {
  const base = `${MEDIA_PREFIX}${media.key}`
  return (
    // eslint-disable-next-line @next/next/no-img-element -- renditions are pre-generated; see the doc comment
    <img
      src={`${base}/640.webp`}
      srcSet={CARD_WIDTHS.map((w) => `${base}/${w}.webp ${w}w`).join(", ")}
      sizes={sizes}
      width={media.width}
      height={media.height}
      alt=""
      loading={preload ? "eager" : "lazy"}
      fetchPriority={preload ? "high" : undefined}
      decoding="async"
      className={cn("absolute inset-0 size-full object-cover", className)}
    />
  )
}

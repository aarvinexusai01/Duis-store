/**
 * next/image loader, and every other link to an uploaded image.
 *
 * Two kinds of storage key (Phase 10):
 * - 32 hex characters: the local media volume. Uploads were re-encoded once
 *   into fixed WebP widths stored as `/media/{key}/{width}.webp`, so the
 *   loader picks the closest stored width and the server never resizes.
 * - `ikp-{hex}` / `ikc-{hex}`: ImageKit, which resizes and picks WebP/AVIF per
 *   browser. A product photo (`ikp-`) has a clean copy no wider than
 *   PRODUCT_CLEAN_MAX_WIDTH and a full-size `zoom` copy with the Duis emblem
 *   baked in; a content image (`ikc-`: banners, journal) one clean full-size
 *   copy.
 * Any other source (files in /public, external URLs) is returned as-is with a
 * width hint so CDNs can still vary the cache by size.
 */

export const MEDIA_PREFIX = "/media/"
export const MEDIA_WIDTHS = [320, 640, 960, 1280, 1920] as const
export const PRODUCT_CLEAN_MAX_WIDTH = 960
export const ZOOM_MAX_WIDTH = 1920

export type MediaWidth = (typeof MEDIA_WIDTHS)[number]
export type MediaVariant = "clean" | "zoom"

const IMAGEKIT_KEY = /^ik([pc])-([a-f0-9]{32})$/

/** Inlined at build time, so the browser builds the same links. */
function imagekitEndpoint(): string {
  return (process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT ?? "").replace(
    /\/+$/,
    "",
  )
}

/** Smallest stored width that covers the request, or the largest one. */
export function nearestMediaWidth(requested: number): MediaWidth {
  for (const width of MEDIA_WIDTHS) {
    if (width >= requested) return width
  }
  return MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1] as MediaWidth
}

/** Where ImageKit keeps an asset's files (also used by the uploader). */
export function imagekitFolder(hex: string): string {
  return `/duis/${hex}`
}

/**
 * The URL of an uploaded image at about `width` pixels. Product photos are
 * never served clean above PRODUCT_CLEAN_MAX_WIDTH; `zoom` asks for the
 * watermarked full-size copy (content images have none and stay clean).
 */
export function mediaSrc(
  key: string,
  width: number,
  variant: MediaVariant = "clean",
): string {
  const ik = IMAGEKIT_KEY.exec(key)
  if (!ik) return `${MEDIA_PREFIX}${key}/${nearestMediaWidth(width)}.webp`
  const [, kind, hex] = ik
  const product = kind === "p"
  const zoom = product && variant === "zoom"
  const file = zoom ? "zoom.webp" : "clean.webp"
  const cap = zoom
    ? ZOOM_MAX_WIDTH
    : product
      ? PRODUCT_CLEAN_MAX_WIDTH
      : ZOOM_MAX_WIDTH
  const w = Math.min(nearestMediaWidth(width), cap)
  return `${imagekitEndpoint()}${imagekitFolder(hex!)}/${file}?tr=w-${w}`
}

type ImageLoaderParams = {
  src: string
  width: number
  quality?: number
}

/** `src` is `/media/{key}`, or `/media/{key}?zoom` for the zoom copy. */
export default function imageLoader({ src, width }: ImageLoaderParams): string {
  if (src.startsWith(MEDIA_PREFIX)) {
    const rest = src.slice(MEDIA_PREFIX.length)
    const key = rest.split(/[/?#]/)[0]
    if (key)
      return mediaSrc(key, width, rest.endsWith("?zoom") ? "zoom" : "clean")
  }
  const separator = src.includes("?") ? "&" : "?"
  return `${src}${separator}w=${width}`
}

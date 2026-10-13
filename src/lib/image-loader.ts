/**
 * next/image loader for self-hosted media.
 *
 * Uploads are re-encoded once into fixed WebP widths stored as
 * `/media/{key}/{width}.webp` (Phase 1 media pipeline), so the loader only
 * picks the closest stored width and the server never resizes per request.
 * Any other source (files in /public, external URLs) is returned as-is with a
 * width hint so CDNs can still vary the cache by size.
 */

export const MEDIA_PREFIX = "/media/"
export const MEDIA_WIDTHS = [320, 640, 960, 1280, 1920] as const

export type MediaWidth = (typeof MEDIA_WIDTHS)[number]

/** Smallest stored width that covers the request, or the largest one. */
export function nearestMediaWidth(requested: number): MediaWidth {
  for (const width of MEDIA_WIDTHS) {
    if (width >= requested) return width
  }
  return MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1] as MediaWidth
}

type ImageLoaderParams = {
  src: string
  width: number
  quality?: number
}

export default function imageLoader({ src, width }: ImageLoaderParams): string {
  if (src.startsWith(MEDIA_PREFIX)) {
    const key = src.slice(MEDIA_PREFIX.length).split(/[/?#]/)[0]
    if (key) return `${MEDIA_PREFIX}${key}/${nearestMediaWidth(width)}.webp`
  }
  const separator = src.includes("?") ? "&" : "?"
  return `${src}${separator}w=${width}`
}

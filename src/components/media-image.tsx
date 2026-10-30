import Image, { type ImageProps } from "next/image"

import type { MediaRef } from "@/features/catalog"

type MediaImageProps = Omit<ImageProps, "src" | "alt" | "width" | "height"> & {
  media: MediaRef
  /** Defaults to the asset's alt text; pass "" for decorative copies. */
  alt?: string
  /** "zoom": the full-size copy, which carries the watermark (Phase 10). */
  variant?: "clean" | "zoom"
}

/** next/image for an uploaded asset; the loader picks a stored rendition. */
export function MediaImage({
  media,
  alt,
  variant = "clean",
  fill,
  style,
  ...props
}: MediaImageProps) {
  return (
    <Image
      src={`/media/${media.key}${variant === "zoom" ? "?zoom" : ""}`}
      alt={alt ?? media.alt}
      {...(fill ? { fill } : { width: media.width, height: media.height })}
      // Staff choose what stays in frame when the image is cropped.
      style={
        media.focal
          ? {
              objectPosition: `${media.focal.x * 100}% ${media.focal.y * 100}%`,
              ...style,
            }
          : style
      }
      {...props}
    />
  )
}

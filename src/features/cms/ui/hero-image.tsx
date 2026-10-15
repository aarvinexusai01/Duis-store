import { getImageProps } from "next/image"

import type { MediaRef } from "@/features/catalog"

/**
 * Art-directed banner image: a separate crop below 768px when the editor
 * supplied one (next/image `getImageProps` + <picture>).
 */
export function BannerImage({
  image,
  mobileImage,
  preload = false,
  sizes = "100vw",
  className,
}: {
  image: MediaRef
  mobileImage?: MediaRef | null
  preload?: boolean
  sizes?: string
  className?: string
}) {
  const common = { alt: image.alt, sizes, preload }
  const {
    props: { srcSet: desktop, ...rest },
  } = getImageProps({
    ...common,
    src: `/media/${image.key}`,
    width: image.width,
    height: image.height,
  })
  const mobile = mobileImage
    ? getImageProps({
        ...common,
        src: `/media/${mobileImage.key}`,
        width: mobileImage.width,
        height: mobileImage.height,
      }).props.srcSet
    : undefined
  return (
    <picture>
      {mobile && <source media="(max-width: 767px)" srcSet={mobile} />}
      <source
        media={mobile ? "(min-width: 768px)" : undefined}
        srcSet={desktop}
      />
      <img {...rest} alt={image.alt} className={className} />
    </picture>
  )
}

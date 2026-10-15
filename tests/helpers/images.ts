import sharp from "sharp"

/** A solid-colour test image, optionally carrying EXIF metadata. */
export async function makeImage({
  width = 1200,
  height = 1500,
  format = "jpeg",
  colour = "#d94f30",
  exifCopyright,
}: {
  width?: number
  height?: number
  format?: "jpeg" | "png" | "webp"
  colour?: string
  exifCopyright?: string
} = {}): Promise<Buffer> {
  let image = sharp({
    create: { width, height, channels: 3, background: colour },
  })
  if (exifCopyright)
    image = image.withExif({ IFD0: { Copyright: exifCopyright } })
  return image.toFormat(format).toBuffer()
}

/** Different bytes every call, so uploads are not deduplicated. */
export async function makeUniqueImage(
  width = 1200,
  height = 1500,
): Promise<Buffer> {
  const channel = () => Math.floor(Math.random() * 256)
  return makeImage({
    width,
    height,
    colour: `rgb(${channel()}, ${channel()}, ${channel()})`,
  })
}

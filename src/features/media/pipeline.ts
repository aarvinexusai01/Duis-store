import "server-only"
import sharp, { type Metadata } from "sharp"

import { MEDIA_WIDTHS } from "@/lib/image-loader"
import { DomainError } from "@/server/errors"
import type { StoredFile } from "@/server/storage/local"

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif"])
const MAX_INPUT_PIXELS = 40_000_000
const MIN_EDGE = 200
const MASTER_MAX_EDGE = 2560

export type ProcessedImage = {
  files: StoredFile[]
  width: number
  height: number
  sourceFormat: string
}

/**
 * Upload sanitisation (doc/02 §4.4, doc/08 §2): only real JPEG/PNG/WebP/AVIF
 * images (no SVG, no animation) under a pixel limit. Everything is decoded and
 * re-encoded, which applies EXIF rotation, strips all metadata (location,
 * camera details) and defeats polyglot files. Every rendition width is written
 * — smaller originals are not enlarged — so the image loader can always pick
 * one.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let metadata: Metadata
  try {
    metadata = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata()
  } catch {
    throw new DomainError(
      "UNSUPPORTED_MEDIA",
      "That file is not an image we can use, or it is too large.",
    )
  }
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new DomainError(
      "UNSUPPORTED_MEDIA",
      "Upload a JPEG, PNG, WebP or AVIF image.",
    )
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new DomainError(
      "UNSUPPORTED_MEDIA",
      "Animated images are not supported.",
    )
  }

  const source = sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "error",
  }).rotate()

  const master = await source
    .clone()
    .resize({
      width: MASTER_MAX_EDGE,
      height: MASTER_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })

  if (master.info.width < MIN_EDGE || master.info.height < MIN_EDGE) {
    throw new DomainError(
      "UNSUPPORTED_MEDIA",
      `Images must be at least ${MIN_EDGE}×${MIN_EDGE} pixels.`,
    )
  }

  const renditions = await Promise.all(
    MEDIA_WIDTHS.map(async (width) => ({
      name: `${width}.webp`,
      data: await source
        .clone()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer(),
    })),
  )

  return {
    files: [{ name: "orig.webp", data: master.data }, ...renditions],
    width: master.info.width,
    height: master.info.height,
    sourceFormat: metadata.format,
  }
}

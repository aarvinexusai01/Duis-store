import "server-only"
import { readFile } from "node:fs/promises"
import path from "node:path"

import sharp, { type Metadata, type Sharp } from "sharp"

import {
  MEDIA_WIDTHS,
  PRODUCT_CLEAN_MAX_WIDTH,
  ZOOM_MAX_WIDTH,
} from "@/lib/image-loader"
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
  const { source, format } = await openImage(input)
  const master = await encodeMaster(source)
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
    sourceFormat: format,
  }
}

/** Checks the upload is a real still image, and returns it EXIF-rotated. */
async function openImage(input: Buffer) {
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
  return { source, format: metadata.format }
}

/** The largest copy kept (also the base every smaller one is cut from). */
async function encodeMaster(source: Sharp) {
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
  return master
}

// --- ImageKit (Phase 10) ------------------------------------------------------

export type ImagePurpose = "product" | "content"

/** The emblem's share of the photo's width, and its opacity. */
const WATERMARK_WIDTH = 0.14
const WATERMARK_OPACITY = 0.55
const WATERMARK_MARGIN = 0.03

let emblem: Promise<Buffer> | undefined
function emblemPng(): Promise<Buffer> {
  emblem ??= readFile(path.resolve("public/brand/emblem-512.png"))
  return emblem
}

/** The emblem, sized for a photo `width` wide, at WATERMARK_OPACITY. */
async function watermark(width: number): Promise<Buffer> {
  const size = Math.max(48, Math.round(width * WATERMARK_WIDTH))
  return sharp(await emblemPng())
    .resize({ width: size })
    .ensureAlpha()
    .composite([
      {
        // Scales every pixel's alpha down (dest-in keeps the emblem's shape).
        input: Buffer.from([
          255,
          255,
          255,
          Math.round(255 * WATERMARK_OPACITY),
        ]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer()
}

/**
 * The files ImageKit stores for an upload, after the same checks and clean
 * re-encode as local uploads (EXIF rotation applied, metadata stripped):
 * - product photo: `clean.webp` no wider than PRODUCT_CLEAN_MAX_WIDTH, and
 *   `zoom.webp` up to ZOOM_MAX_WIDTH with the emblem bottom-right, so no
 *   clean full-size copy is ever public;
 * - content image (banners, journal): one clean `clean.webp` at full size.
 */
export async function processImageForImageKit(
  input: Buffer,
  purpose: ImagePurpose,
): Promise<ProcessedImage> {
  const { source, format } = await openImage(input)
  const master = await encodeMaster(source)
  const { width, height } = master.info
  if (purpose === "content") {
    return {
      files: [{ name: "clean.webp", data: master.data }],
      width,
      height,
      sourceFormat: format,
    }
  }
  const clean = await sharp(master.data)
    .resize({ width: PRODUCT_CLEAN_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
  // Sized first, then marked and encoded once.
  const zoomWidth = Math.min(width, ZOOM_MAX_WIDTH)
  const zoomHeight = Math.round((height * zoomWidth) / width)
  const mark = await watermark(zoomWidth)
  const markMeta = await sharp(mark).metadata()
  const margin = Math.round(zoomWidth * WATERMARK_MARGIN)
  const zoom = await sharp(
    await sharp(master.data)
      .resize({ width: zoomWidth, height: zoomHeight })
      // Three channels, even from a transparent PNG.
      .flatten({ background: "#ffffff" })
      .raw()
      .toBuffer(),
    { raw: { width: zoomWidth, height: zoomHeight, channels: 3 } },
  )
    .composite([
      {
        input: mark,
        left: zoomWidth - (markMeta.width ?? 0) - margin,
        top: zoomHeight - (markMeta.height ?? 0) - margin,
      },
    ])
    .webp({ quality: 82 })
    .toBuffer()
  return {
    files: [
      { name: "clean.webp", data: clean },
      { name: "zoom.webp", data: zoom },
    ],
    width,
    height,
    sourceFormat: format,
  }
}

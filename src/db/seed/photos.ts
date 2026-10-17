import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import type { Garment } from "./data"
import manifest from "./photos/manifest.json"

/**
 * Demo photography (owner decision 2026-10-17): Pexels photos chosen per
 * garment and the closest colour, stored at upload size in ./photos. For
 * development and demos only (see ./photos/CREDITS.md); the live store needs
 * its own product shoots. Missing files fall back to the drawn placeholders.
 */

// Read relative to the repository root: the seed runs as a bundle in dist/.
const DIR = path.resolve("src/db/seed/photos")

function read(id: number): Buffer | null {
  const file = path.join(DIR, `${id}.jpg`)
  return existsSync(file) ? readFileSync(file) : null
}

export type Photo = { id: number; bytes: Buffer }

/**
 * Front photo, plus an optional second shot, for a garment in a colour.
 * Identical files upload as one shared image, and a product can show an
 * image only once, so photos in `used` (this product's) are left out.
 */
export function productPhotos(
  garment: Garment,
  colour: string,
  used: Set<number> = new Set(),
): Photo[] {
  const ids =
    (manifest.products as Record<string, number[]>)[`${garment}:${colour}`] ??
    []
  return ids.flatMap((id) => {
    const bytes = used.has(id) ? null : read(id)
    return bytes ? [{ id, bytes }] : []
  })
}

/** Campaign banner photo `i` (hero first, then promos), if there is one. */
export function bannerPhoto(i: number): Buffer | null {
  const id = manifest.banners[i]
  return id === undefined ? null : read(id)
}

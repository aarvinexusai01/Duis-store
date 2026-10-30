import "server-only"
import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"
import { imagekitEnabled, uploadToImageKit } from "@/server/storage/imagekit"
import { readMediaFile } from "@/server/storage/local"

import { processImageForImageKit } from "./pipeline"

/**
 * Moves images from the local media volume to ImageKit (Phase 10c). Each
 * stored master (orig.webp, already sanitised) becomes the ImageKit copies:
 * product photos (used by any product) get the capped clean and the
 * watermarked zoom, everything else one clean full-size copy. The asset's key
 * then switches to `ikp-`/`ikc-`, which moves it everywhere at once (pages
 * read the key at render time; the search index follows by trigger).
 *
 * Safe to run again: moved assets are skipped, and a key only changes if it
 * still holds the local value. Local files are left in place, so old order
 * lines and a rollback keep working.
 */
export async function moveMediaToImageKit(options: {
  dryRun?: boolean
  log?: (line: string) => void
}): Promise<{ moved: number; failed: number; total: number }> {
  if (!imagekitEnabled()) {
    throw new Error(
      "ImageKit is not configured (NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT and IMAGEKIT_PRIVATE_KEY)",
    )
  }
  const log = options.log ?? (() => {})
  const { rows } = await getDb().execute<{
    id: string
    storage_key: string
    product: boolean
  }>(sql`
    select m.id, m.storage_key,
           exists (select 1 from product_media pm where pm.media_id = m.id) as product
    from media_assets m
    where m.storage_key ~ '^[a-f0-9]{32}$'
    order by m.created_at`)
  let moved = 0
  let failed = 0
  for (const row of rows) {
    const purpose = row.product ? "product" : "content"
    const label = `${row.storage_key} (${purpose})`
    try {
      const master = await readMediaFile(row.storage_key, "orig.webp")
      if (!master) throw new Error("orig.webp is missing on the media volume")
      if (options.dryRun) {
        log(`would move ${label}`)
        moved += 1
        continue
      }
      const processed = await processImageForImageKit(master, purpose)
      await uploadToImageKit(row.storage_key, processed.files)
      const newKey = `${row.product ? "ikp" : "ikc"}-${row.storage_key}`
      await getDb().execute(sql`
        update media_assets set storage_key = ${newKey}, updated_at = now()
        where id = ${row.id} and storage_key = ${row.storage_key}`)
      moved += 1
      log(`moved ${label} → ${newKey}`)
    } catch (err) {
      failed += 1
      log(`FAILED ${label}: ${(err as Error).message}`)
    }
  }
  return { moved, failed, total: rows.length }
}

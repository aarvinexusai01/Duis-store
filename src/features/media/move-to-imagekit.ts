import "server-only"
import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"
import { imagekitEnabled, uploadToImageKit } from "@/server/storage/imagekit"
import { hideMediaFiles, readMediaFile } from "@/server/storage/local"

import { processImageForImageKit } from "./pipeline"

/**
 * Moves images from the local media volume to ImageKit (Phase 10c). Each
 * stored master (orig.webp, already sanitised) becomes the ImageKit copies:
 * product photos (used by any product) get the capped clean and the
 * watermarked zoom, everything else one clean full-size copy. The asset's key
 * then switches to `ikp-`/`ikc-`, which moves it everywhere at once (pages
 * read the key at render time; the search index follows by trigger).
 *
 * Order lines that saved the old key are pointed at the new one. The local
 * files are then hidden (kept in the volume's .moved folder, out of public
 * reach): otherwise /media/{hex}/orig.webp would still be the clean full-size
 * original that the watermark exists to protect.
 *
 * Safe to run again: moved assets are skipped (their leftover local files and
 * order lines are still tidied), and a key only changes if it still holds the
 * local value.
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
  if (!options.dryRun) await tidyMoved(log)
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
      await getDb().transaction(async (tx) => {
        await tx.execute(sql`
          update media_assets set storage_key = ${newKey}, updated_at = now()
          where id = ${row.id} and storage_key = ${row.storage_key}`)
        await tx.execute(sql`
          update order_items set image_key = ${newKey}
          where image_key = ${row.storage_key}`)
      })
      await hideMediaFiles(row.storage_key)
      moved += 1
      log(`moved ${label} → ${newKey}`)
    } catch (err) {
      failed += 1
      log(`FAILED ${label}: ${(err as Error).message}`)
    }
  }
  return { moved, failed, total: rows.length }
}

/**
 * Assets already on ImageKit: hide any local files still public and repoint
 * order lines (the first version of this move left both in place).
 */
async function tidyMoved(log: (line: string) => void): Promise<void> {
  const { rows } = await getDb().execute<{ storage_key: string }>(sql`
    select storage_key from media_assets where storage_key ~ '^ik[pc]-[a-f0-9]{32}$'`)
  let hidden = 0
  for (const { storage_key: key } of rows) {
    const hex = key.slice(4)
    await getDb().execute(sql`
      update order_items set image_key = ${key} where image_key = ${hex}`)
    if (await hideMediaFiles(hex)) hidden += 1
  }
  if (hidden > 0)
    log(`hid ${hidden} local copies of images already on ImageKit`)
}

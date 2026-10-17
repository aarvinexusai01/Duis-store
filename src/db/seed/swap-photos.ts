import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { setProductMedia } from "@/features/catalog"
import { deleteMedia, uploadImage } from "@/features/media"
import { systemActor } from "@/server/auth/actor"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { closeDb, getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { stopSender } from "@/server/jobs/enqueue"

import { COLOURS, PRODUCT_GROUPS } from "./data"
import { bannerPhoto, productPhotos, type Photo } from "./photos"

/**
 * Puts the demo photos into an existing development database without
 * reseeding (owner decision 2026-10-17):
 *   npm run db:seed:photos
 * Only images the seed drew are replaced, recognised by their alt text
 * (identical drawings were shared, so it may name another seeded product);
 * products and banners staff added are left alone. Safe to run again.
 */

type MediaRow = {
  product_id: string
  title: string
  media_id: string
  color_value_id: string | null
  alt_text: string | null
}

const SEEDED = /^(.+) in (.+), (front|back)$/

async function swapProducts(actor: ReturnType<typeof systemActor>) {
  const garmentOf = new Map(
    PRODUCT_GROUPS.flatMap((group) =>
      group.products.map((product) => [product.name, group.garment] as const),
    ),
  )
  const slugOf = new Map<string, string>(COLOURS.map((c) => [c.label, c.slug]))
  const rows = await getDb().execute<MediaRow>(sql`
    select p.id as product_id, p.title, pm.media_id, pm.color_value_id, m.alt_text
    from product_media pm
    join products p on p.id = pm.product_id
    join media_assets m on m.id = pm.media_id
    order by p.id, pm.position`)
  const byProduct = Map.groupBy(rows.rows, (row) => row.product_id)

  const replaced: string[] = []
  let changed = 0
  for (const [productId, items] of byProduct) {
    const garment = garmentOf.get(items[0]!.title)
    if (!garment) continue
    const used = new Set<number>()
    const byColour = new Map<string, Photo[]>()
    const next: {
      mediaId: string
      colorValueId: string | null
      altOverride?: string
    }[] = []
    let touched = false
    for (const item of items) {
      const match = SEEDED.exec(item.alt_text ?? "")
      const colour = match ? slugOf.get(match[2]!) : undefined
      if (!match || !garmentOf.has(match[1]!) || !colour) {
        next.push({ mediaId: item.media_id, colorValueId: item.color_value_id })
        continue
      }
      // Looked up once per colour, so front and back see the same list.
      let photos = byColour.get(colour)
      if (!photos) {
        photos = productPhotos(garment, colour, used)
        for (const p of photos) used.add(p.id)
        byColour.set(colour, photos)
      }
      const photo = match[3] === "front" ? photos[0] : photos[1]
      if (!photo) {
        // A drawn back beside a photographed front looks wrong: drop it.
        if (match[3] === "back" && photos[0]) {
          replaced.push(item.media_id)
          touched = true
        } else {
          next.push({
            mediaId: item.media_id,
            colorValueId: item.color_value_id,
          })
        }
        continue
      }
      const alt = `${item.title} in ${match[2]}, ${match[3] === "front" ? "front" : "another view"}`
      const uploaded = await uploadImage(actor, {
        bytes: photo.bytes,
        altText: alt,
      })
      next.push({
        mediaId: uploaded.id,
        colorValueId: item.color_value_id,
        altOverride: alt,
      })
      if (uploaded.id !== item.media_id) {
        replaced.push(item.media_id)
        touched = true
      }
    }
    if (!touched) continue
    await setProductMedia(actor, { productId, items: next })
    changed += 1
  }
  return { changed, replaced }
}

async function swapBanners(actor: ReturnType<typeof systemActor>) {
  const banners = await getDb().execute<{ id: string }>(sql`
    select id from media_assets
    where alt_text = 'Duis campaign banner' and deleted_at is null
    order by created_at, id`)
  const replaced: string[] = []
  for (const [i, banner] of banners.rows.entries()) {
    const photo = bannerPhoto(i)
    if (!photo) continue
    const uploaded = await uploadImage(actor, {
      bytes: photo,
      altText: "Duis campaign photo",
    })
    if (uploaded.id === banner.id) continue
    await withTransaction(async (tx) => {
      await tx.execute(sql`
        update collections set banner_media_id = ${uploaded.id} where banner_media_id = ${banner.id}`)
      await tx.execute(sql`
        update collections set image_media_id = ${uploaded.id} where image_media_id = ${banner.id}`)
      // Page revisions hold the ID inside their block data and in the refs.
      await tx.execute(sql`
        update cms_revisions set data = replace(data::text, ${banner.id}, ${uploaded.id})::jsonb
        where data::text like ${`%${banner.id}%`}`)
      await tx.execute(sql`
        update cms_revision_refs set media_id = ${uploaded.id} where media_id = ${banner.id}`)
    })
    replaced.push(banner.id)
  }
  if (replaced.length > 0) {
    const pages = await getDb().execute<{ slug: string }>(
      sql`select slug from cms_pages`,
    )
    const collections = await getDb().execute<{ id: string }>(
      sql`select id from collections`,
    )
    await requestRevalidation([
      cacheTags.cmsPagesList,
      cacheTags.collectionsList,
      ...pages.rows.map((p) => cacheTags.cmsPage(p.slug)),
      ...collections.rows.map((c) => cacheTags.collection(c.id)),
    ])
  }
  return replaced
}

async function main() {
  const env = getServerEnv()
  if (env.APP_ENV === "production" || env.APP_ENV === "staging") {
    throw new Error(`Refusing to change demo images in ${env.APP_ENV}.`)
  }
  const actor = systemActor("seed-photos")
  const products = await swapProducts(actor)
  const banners = await swapBanners(actor)

  // Retire the drawings nothing uses any more.
  let retired = 0
  for (const id of new Set([...products.replaced, ...banners])) {
    const result = await deleteMedia(actor, { id }).catch(() => null)
    if (result) retired += 1
  }
  console.log(
    `Photos on ${products.changed} products and ${banners.length} banners; ${retired} drawn images retired.`,
  )
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await stopSender()
    await closeDb()
  })

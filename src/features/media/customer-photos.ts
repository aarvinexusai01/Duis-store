import "server-only"
import { sql } from "drizzle-orm"
import sharp, { type OutputInfo } from "sharp"
import { z } from "zod"

import { rolesAllow } from "@/server/auth/permissions"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"
import { readPrivateFile, writePrivateFile } from "@/server/storage/private"

/**
 * Photos customers attach to an exchange request or a review (doc/08 §2).
 * Re-encoded to WebP (which also drops location and camera metadata) and
 * kept in private storage. Who may see one: its owner, staff handling
 * exchanges or reviews, and anyone once its review is approved.
 */

const MAX_BYTES = 8 * 1024 * 1024
const MAX_EDGE = 1600
const DAILY_LIMIT = 20

export const uploadCustomerPhoto = defineOperation({
  name: "photos.upload",
  access: "authenticated",
  input: z.object({
    bytes: z.custom<Uint8Array>(
      (value) => value instanceof Uint8Array,
      "Expected file bytes.",
    ),
  }),
  async handler({ actor }, { bytes }) {
    if (actor.kind !== "user")
      throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      throw new DomainError("PAYLOAD_TOO_LARGE", "Photos must be under 8 MB.")
    }
    const today = await getDb().execute<{ n: number }>(sql`
      select count(*)::int as n from customer_photos
      where user_id = ${actor.userId} and created_at > now() - interval '1 day'`)
    if (today.rows[0]!.n >= DAILY_LIMIT) {
      throw new DomainError(
        "RATE_LIMITED",
        "You've added a lot of photos today. Try again tomorrow.",
      )
    }
    let output: { data: Buffer; info: OutputInfo }
    try {
      const image = sharp(Buffer.from(bytes), {
        limitInputPixels: 40_000_000,
        failOn: "error",
      })
      const meta = await image.metadata()
      if (
        !meta.format ||
        !["jpeg", "png", "webp", "heif", "avif"].includes(meta.format) ||
        (meta.pages ?? 1) > 1
      ) {
        throw new Error("format")
      }
      output = await image
        .rotate()
        .resize({
          width: MAX_EDGE,
          height: MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true })
    } catch {
      throw new DomainError(
        "UNSUPPORTED_MEDIA",
        "Upload a photo (JPEG, PNG, WebP or HEIC).",
      )
    }
    const created = await getDb().execute<{ id: string }>(sql`
      insert into customer_photos (user_id, file_key, width, height)
      values (${actor.userId}, '', ${output.info.width}, ${output.info.height})
      returning id`)
    const id = created.rows[0]!.id
    const key = await writePrivateFile("photos", `${id}.webp`, output.data)
    await getDb().execute(
      sql`update customer_photos set file_key = ${key} where id = ${id}`,
    )
    return { id, width: output.info.width, height: output.info.height }
  },
})

/**
 * A photo's bytes if this actor may see it, and whether it is public (an
 * approved review's photo, which may be cached).
 */
export async function readCustomerPhoto(
  actor: Parameters<typeof uploadCustomerPhoto>[0],
  photoId: string,
): Promise<{ data: Buffer; public: boolean } | null> {
  const found = await getDb().execute<{
    file_key: string
    user_id: string
    approved: boolean
    in_exchange: boolean
    in_review: boolean
  }>(sql`
    select p.file_key, p.user_id,
      exists (select 1 from review_photos rp join reviews r on r.id = rp.review_id
              where rp.photo_id = p.id and r.status = 'approved') as approved,
      exists (select 1 from exchange_request_photos ep where ep.photo_id = p.id) as in_exchange,
      exists (select 1 from review_photos rp where rp.photo_id = p.id) as in_review
    from customer_photos p where p.id = ${photoId}`)
  const photo = found.rows[0]
  if (!photo?.file_key) return null
  const staffMay =
    actor.kind === "user" &&
    actor.twoFactorEnabled &&
    ((photo.in_exchange && rolesAllow(actor.roles, { exchange: ["read"] })) ||
      (photo.in_review && rolesAllow(actor.roles, { review: ["read"] })))
  const owner = actor.kind === "user" && actor.userId === photo.user_id
  if (!photo.approved && !owner && !staffMay) return null
  const data = await readPrivateFile(photo.file_key)
  return data ? { data, public: photo.approved } : null
}

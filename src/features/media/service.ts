import "server-only"
import { createHash } from "node:crypto"

import { and, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { mediaAssets } from "@/db/schema"
import { MEDIA_WIDTHS } from "@/lib/image-loader"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"
import { mediaUrl, storeMediaFiles } from "@/server/storage/local"

import { processImage } from "./pipeline"

export type UploadedMedia = {
  id: string
  storageKey: string
  url: string
  width: number
  height: number
  reused: boolean
}

export const uploadImage = defineOperation({
  name: "media.uploadImage",
  access: { media: ["upload"] },
  input: z.object({
    // Any byte array (Buffer included); z.instanceof would narrow the type.
    bytes: z.custom<Uint8Array>(
      (value) => value instanceof Uint8Array,
      "Expected file bytes.",
    ),
    filename: z.string().max(255).optional(),
    altText: z.string().trim().max(300).default(""),
  }),
  async handler(
    { actor, log },
    { bytes, filename, altText },
  ): Promise<UploadedMedia> {
    const maxBytes = getServerEnv().MEDIA_MAX_UPLOAD_BYTES
    if (bytes.byteLength === 0)
      throw new DomainError("VALIDATION_FAILED", "The file is empty.")
    if (bytes.byteLength > maxBytes) {
      throw new DomainError(
        "PAYLOAD_TOO_LARGE",
        `Images must be under ${Math.floor(maxBytes / 1048576)} MB.`,
      )
    }

    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const sha256 = createHash("sha256").update(input).digest("hex")

    // Identical bytes: reuse (and restore) the existing asset.
    const [existing] = await getDb()
      .update(mediaAssets)
      .set({ deletedAt: null })
      .where(eq(mediaAssets.sha256, sha256))
      .returning()
    if (existing) {
      return {
        id: existing.id,
        storageKey: existing.storageKey,
        url: mediaUrl(existing.storageKey),
        width: existing.width,
        height: existing.height,
        reused: true,
      }
    }

    const processed = await processImage(input)
    const storageKey = sha256.slice(0, 32)
    await storeMediaFiles(storageKey, processed.files)
    const master = processed.files.find((file) => file.name === "orig.webp")!

    return withTransaction(async (tx) => {
      const [row] = await tx
        .insert(mediaAssets)
        .values({
          storageKey,
          sha256,
          originalFilename: filename?.slice(0, 255) ?? null,
          mime: "image/webp",
          bytes: master.data.byteLength,
          width: processed.width,
          height: processed.height,
          renditions: [...MEDIA_WIDTHS],
          altText,
          uploadedBy: actor.kind === "user" ? actor.userId : null,
        })
        .onConflictDoUpdate({
          target: mediaAssets.sha256,
          set: { deletedAt: null },
        })
        .returning()
      await writeAudit(tx, actor, {
        action: "media.upload",
        entityType: "media",
        entityId: row!.id,
        changes: {
          filename,
          bytes: input.byteLength,
          sourceFormat: processed.sourceFormat,
        },
      })
      log.info({ mediaId: row!.id, storageKey }, "image uploaded")
      return {
        id: row!.id,
        storageKey,
        url: mediaUrl(storageKey),
        width: processed.width,
        height: processed.height,
        reused: false,
      }
    })
  },
})

export const updateMediaDetails = defineOperation({
  name: "media.updateMediaDetails",
  access: { media: ["update"] },
  input: z.object({
    id: z.uuid(),
    altText: z.string().trim().max(300).optional(),
    caption: z.string().trim().max(500).nullish(),
    focalX: z.number().min(0).max(1).optional(),
    focalY: z.number().min(0).max(1).optional(),
  }),
  async handler({ actor }, { id, ...changes }) {
    return withTransaction(async (tx) => {
      const [row] = await tx
        .update(mediaAssets)
        .set(changes)
        .where(and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt)))
        .returning({ id: mediaAssets.id })
      if (!row) throw new DomainError("NOT_FOUND", "Image not found.")
      await requestRevalidation([cacheTags.media(id)], { tx })
      await writeAudit(tx, actor, {
        action: "media.update",
        entityType: "media",
        entityId: id,
        changes,
      })
      return { id }
    })
  },
})

/** Where an image is used; deletion is blocked while any of these exist. */
export type MediaListItem = {
  id: string
  key: string
  width: number
  height: number
  alt: string
  filename: string | null
  createdAt: Date
}

export const MEDIA_PAGE_SIZE = 48

/** The media library, newest first; search matches alt text and file name. */
export const adminListMedia = defineOperation({
  name: "media.adminList",
  access: { media: ["read"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, { q, page }) {
    const like = q ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null
    const rows = await getDb().execute<{
      id: string
      storage_key: string
      width: number
      height: number
      alt_text: string
      original_filename: string | null
      created_at: Date
      total: number
    }>(sql`
      select id, storage_key, width, height, alt_text, original_filename, created_at,
             count(*) over ()::int as total
      from media_assets
      where deleted_at is null
        and (${like}::text is null or alt_text ilike ${like} or original_filename ilike ${like})
      order by created_at desc, id desc
      limit ${MEDIA_PAGE_SIZE} offset ${(page - 1) * MEDIA_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      items: rows.rows.map((r): MediaListItem => ({
        id: r.id,
        key: r.storage_key,
        width: r.width,
        height: r.height,
        alt: r.alt_text,
        filename: r.original_filename,
        createdAt: new Date(r.created_at),
      })),
    }
  },
})

export async function mediaUsage(mediaId: string) {
  const result = await getDb().execute<{ kind: string; count: number }>(sql`
    select 'product' as kind, count(*)::int as count from product_media where media_id = ${mediaId}
    union all select 'product_og', count(*)::int from products where og_media_id = ${mediaId}
    union all select 'category', count(*)::int from categories where image_media_id = ${mediaId}
    union all select 'collection', count(*)::int from collections
      where image_media_id = ${mediaId} or banner_media_id = ${mediaId}
    union all select 'content', count(distinct r.revision_id)::int
      from cms_revision_refs r
      join cms_revisions rev on rev.id = r.revision_id
      where r.media_id = ${mediaId} and rev.workflow_status <> 'archived'
  `)
  return result.rows.filter((row) => row.count > 0)
}

/**
 * Soft delete: the asset disappears from the library but its files stay on
 * disk (and in backups). Refused while anything still uses it.
 */
export const deleteMedia = defineOperation({
  name: "media.deleteMedia",
  access: { media: ["delete"] },
  input: z.object({ id: z.uuid() }),
  async handler({ actor }, { id }) {
    const usage = await mediaUsage(id)
    if (usage.length > 0) {
      throw new DomainError("CONFLICT", "This image is still in use.", {
        usage,
      })
    }
    return withTransaction(async (tx) => {
      const [row] = await tx
        .update(mediaAssets)
        .set({ deletedAt: new Date() })
        .where(and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt)))
        .returning({ id: mediaAssets.id })
      if (!row) throw new DomainError("NOT_FOUND", "Image not found.")
      await writeAudit(tx, actor, {
        action: "media.delete",
        entityType: "media",
        entityId: id,
      })
      return { id }
    })
  },
})

import { revalidateTag } from "next/cache"
import { connection } from "next/server"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { CACHE_TAG, MAX_TAGS_PER_JOB } from "@/server/cache/tags"
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyPayload,
} from "@/server/security/hmac"

const MAX_BODY_BYTES = 16 * 1024

const bodySchema = z.object({
  tags: z.array(z.string().regex(CACHE_TAG)).min(1).max(MAX_TAGS_PER_JOB),
})

/**
 * Receives the worker's signed revalidation fan-out. Blocked at Nginx in
 * production, and useless without the shared secret anyway.
 */
export async function POST(request: Request) {
  await connection()

  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 })
  }

  const valid = verifyPayload(
    getServerEnv().INTERNAL_REVALIDATE_SECRET,
    body,
    request.headers.get(TIMESTAMP_HEADER),
    request.headers.get(SIGNATURE_HEADER),
  )
  if (!valid)
    return Response.json({ error: "invalid signature" }, { status: 401 })

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success)
    return Response.json({ error: "invalid body" }, { status: 400 })

  // Admin and CMS changes favour correctness: the next request rebuilds
  // instead of being served stale content (ADR-017).
  for (const tag of parsed.data.tags) revalidateTag(tag, { expire: 0 })

  return Response.json({ revalidated: parsed.data.tags.length })
}

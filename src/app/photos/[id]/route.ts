import { connection, type NextRequest } from "next/server"

import { readCustomerPhoto } from "@/features/media"
import { getActor } from "@/server/auth/session"

/**
 * A customer photo. Approved review photos are public and cacheable; any
 * other is shown only to its owner and the staff handling it (else 404).
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/photos/[id]">,
) {
  await connection()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 })
  const photo = await readCustomerPhoto(await getActor(), id)
  if (!photo) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "content-type": "image/webp",
      "cache-control": photo.public
        ? "public, max-age=86400"
        : "private, no-store",
      "x-content-type-options": "nosniff",
    },
  })
}

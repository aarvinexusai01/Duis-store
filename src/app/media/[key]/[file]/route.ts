import { connection } from "next/server"

import { readMediaFile } from "@/server/storage/local"

/**
 * Serves processed images. In production Nginx serves /media/* straight from
 * the volume (doc/07 §2); this handler covers development and acts as a
 * fallback. Files are content-addressed, so they can be cached forever.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/media/[key]/[file]">,
) {
  await connection()
  const { key, file } = await params
  const data = await readMediaFile(key, file)
  if (!data) return new Response("Not found", { status: 404 })

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

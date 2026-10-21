import { connection } from "next/server"

import { loadMediaRefs } from "@/features/catalog"
import { getPublishedSiteSettings } from "@/features/cms/queries"

/**
 * The browser-tab icon (doc/06 Phase 6b): the favicon from site settings,
 * or a DUIS monogram. Linked from the root layout's metadata.
 */
export async function GET() {
  await connection()
  const settings = await getPublishedSiteSettings()
  const id = settings?.faviconMediaId
  const media = id ? (await loadMediaRefs([id])).get(id) : undefined
  if (media) {
    return new Response(null, {
      status: 307,
      headers: {
        location: `/media/${media.key}/320.webp`,
        "cache-control": "public, max-age=300",
      },
    })
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#111111"/><text x="32" y="46" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="40" fill="#f4f1ea">D</text></svg>`
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=300",
    },
  })
}

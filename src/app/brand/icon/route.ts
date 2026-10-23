import { connection } from "next/server"

import { loadMediaRefs } from "@/features/catalog"
import { getPublishedSiteSettings } from "@/features/cms/queries"

/**
 * The browser-tab icon (doc/06 Phase 6b): the favicon from site settings,
 * or the Duis emblem. Linked from the root layout's metadata.
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
  // The Duis emblem (scripts/make-brand-assets.mjs).
  return new Response(null, {
    status: 307,
    headers: {
      location: "/brand/favicon-64.png",
      "cache-control": "public, max-age=300",
    },
  })
}

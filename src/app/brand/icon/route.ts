import { connection } from "next/server"

import { loadMediaRefs } from "@/features/catalog"
import { getPublishedSiteSettings } from "@/features/cms/queries"
import { mediaSrc } from "@/lib/image-loader"

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
        location: mediaSrc(media.key, 320),
        "cache-control": "public, max-age=300",
      },
    })
  }
  // The Duis logo (scripts/make-brand-assets.mjs), black or light to suit
  // the browser's tab bar.
  return new Response(null, {
    status: 307,
    headers: {
      location: "/brand/icon.svg",
      "cache-control": "public, max-age=300",
    },
  })
}

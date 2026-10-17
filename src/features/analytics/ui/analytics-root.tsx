import { connection } from "next/server"

import { getServerEnv } from "@/config/env"

import { Analytics } from "./analytics"

/**
 * Reads the measurement IDs per request, so one build serves every
 * environment. Render inside <Suspense>.
 */
export async function AnalyticsRoot() {
  await connection()
  const env = getServerEnv()
  return (
    <Analytics
      ga4Id={env.GA4_MEASUREMENT_ID ?? null}
      pixelId={env.META_PIXEL_ID ?? null}
    />
  )
}

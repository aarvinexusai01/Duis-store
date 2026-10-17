"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

import { ConsentBanner } from "./consent-banner"
import { useConsent } from "./consent-store"
import { applyConsent, pixelPageView } from "./trackers"

/**
 * The consent banner plus GA4 and the Meta Pixel, each started only once
 * the visitor allowed it and its ID is set (ADR-0027).
 */
export function Analytics({
  ga4Id,
  pixelId,
}: {
  ga4Id: string | null
  pixelId: string | null
}) {
  const consent = useConsent()
  const pathname = usePathname()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (!consent) return
    applyConsent(consent, { ga4Id, pixelId })
    if (lastPath.current !== pathname) {
      lastPath.current = pathname
      pixelPageView()
    }
  }, [consent, ga4Id, pixelId, pathname])

  return <ConsentBanner />
}

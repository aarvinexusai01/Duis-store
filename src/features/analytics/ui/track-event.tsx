"use client"

import { useEffect } from "react"

import { track, type AnalyticsEvent } from "./trackers"

/**
 * Records an e-commerce event once when it renders (server pages pass the
 * event in). With `onceKey`, never again in this browser, e.g. a purchase
 * whose confirmation page is reloaded.
 */
export function TrackEvent({
  event,
  onceKey,
}: {
  event: AnalyticsEvent
  onceKey?: string
}) {
  const signature = JSON.stringify(event)
  useEffect(() => {
    if (onceKey) {
      const key = `duis_tracked:${onceKey}`
      try {
        if (localStorage.getItem(key)) return
        localStorage.setItem(key, "1")
      } catch {
        // Storage blocked: record it anyway.
      }
    }
    track(JSON.parse(signature) as AnalyticsEvent)
  }, [signature, onceKey])
  return null
}

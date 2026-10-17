"use client"

import { openCookieSettings } from "./consent-store"

/** "Cookie settings" in the footer: reopens the consent banner. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openCookieSettings} className={className}>
      Cookie settings
    </button>
  )
}

"use client"

import { useEffect } from "react"

/**
 * Marks <html> while the admin is on screen, so globals.css keeps the
 * browser's scrollbars here (wide tables need them) and hides them on the
 * storefront. An effect rather than a DOM check: after a client-side
 * navigation Next.js keeps the admin tree in the document, hidden, and runs
 * this cleanup when it hides it.
 */
export function AdminScrollbars() {
  useEffect(() => {
    document.documentElement.dataset.admin = ""
    return () => {
      delete document.documentElement.dataset.admin
    }
  }, [])
  return null
}

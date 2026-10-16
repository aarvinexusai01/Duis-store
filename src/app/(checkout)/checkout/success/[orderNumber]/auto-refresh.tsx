"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

/** Re-checks a pending payment every 3 s for up to a minute. */
export function AutoRefresh() {
  const router = useRouter()
  useEffect(() => {
    let runs = 0
    const timer = setInterval(() => {
      runs += 1
      if (runs > 20) clearInterval(timer)
      else router.refresh()
    }, 3_000)
    return () => clearInterval(timer)
  }, [router])
  return null
}

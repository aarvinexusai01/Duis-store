"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { withParams } from "@/lib/admin-query"

/**
 * The search box of an admin GET filter form that also searches as you type:
 * once typing pauses it opens the form's URL in place, without a history
 * entry per pause. Enter still submits the form, which works without
 * JavaScript.
 */
export function SearchInput(props: React.ComponentProps<"input">) {
  const router = useRouter()
  const ref = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState<string>()

  // The cleanup also cancels a pending search when the page is left.
  useEffect(() => {
    if (typed === undefined) return
    const timer = setTimeout(() => {
      const form = ref.current?.form
      if (!form) return
      // getAttribute: a field named "action" (audit) shadows form.action.
      const path = form.getAttribute("action") || window.location.pathname
      const fields = Object.fromEntries(new FormData(form))
      const href = withParams(path, fields as Record<string, string>)
      const { pathname, search } = window.location
      if (href !== pathname + search) {
        router.replace(href as Route, { scroll: false })
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [typed, router])

  return (
    <input
      {...props}
      ref={ref}
      type="search"
      onChange={(event) => setTyped(event.target.value)}
    />
  )
}

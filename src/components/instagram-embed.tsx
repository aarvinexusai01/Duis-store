"use client"

import { useEffect, useRef } from "react"

import { useConsent } from "@/features/analytics/ui/consent-store"

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } }
  }
}

let loading: Promise<void> | null = null
function loadInstagram(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://www.instagram.com/embed.js"
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null
      reject(new Error("Instagram failed to load"))
    }
    document.body.append(script)
  })
  return loading
}

/**
 * An Instagram post (doc/06 Phase 6c). Instagram's script sets tracking
 * cookies, so it loads only after marketing consent; before that, readers
 * get a link to open the post on Instagram.
 */
export function InstagramEmbed({ url }: { url: string }) {
  const consent = useConsent()
  const box = useRef<HTMLDivElement>(null)
  const allowed = consent?.marketing === true

  useEffect(() => {
    if (!allowed) return
    void loadInstagram()
      .then(() => window.instgrm?.Embeds.process())
      .catch(() => {})
  }, [allowed])

  if (!allowed) {
    return (
      <p className="my-8 border bg-card p-6 text-center text-sm">
        This post includes an Instagram post.{" "}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline underline-offset-4"
        >
          Open it on Instagram
        </a>
        <span className="mt-1 block text-xs text-muted-foreground">
          It shows here once you allow marketing cookies (Cookie settings, at
          the bottom of the page).
        </span>
      </p>
    )
  }
  return (
    <div ref={box} className="my-8 flex justify-center">
      <blockquote
        className="instagram-media"
        data-instgrm-permalink={url}
        data-instgrm-version="14"
        style={{ maxWidth: 540, width: "100%" }}
      >
        <a href={url} target="_blank" rel="noopener noreferrer">
          View this post on Instagram
        </a>
      </blockquote>
    </div>
  )
}

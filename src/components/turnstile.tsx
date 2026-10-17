"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type TurnstileApi = {
  render(
    element: HTMLElement,
    options: {
      sitekey: string
      callback(token: string): void
      "expired-callback"(): void
      "error-callback"(): void
      appearance?: "always" | "execute" | "interaction-only"
    },
  ): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
let loading: Promise<void> | null = null

function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null
      reject(new Error("Turnstile failed to load"))
    }
    document.head.append(script)
  })
  return loading
}

/**
 * Cloudflare Turnstile for forms that send codes, create accounts or send
 * messages (doc/06 Phase 5 §4). Invisible for most people. With no site key
 * (not configured) it renders nothing and sends no header. The token is
 * single use: call reset() after each request.
 */
export function useTurnstile(siteKey: string | null) {
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return
        widget.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: setToken,
          "expired-callback": () => setToken(null),
          "error-callback": () => setToken(null),
        })
      })
      .catch(() => setToken(null))
    return () => {
      cancelled = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [siteKey])

  const reset = useCallback(() => {
    setToken(null)
    if (widget.current) window.turnstile?.reset(widget.current)
  }, [])

  return {
    element: siteKey ? <div ref={container} className="min-h-0" /> : null,
    /** Fetch options for the Better Auth client call. */
    fetchOptions: token
      ? { headers: { "x-captcha-response": token } }
      : undefined,
    /** The token itself, for forms that post it to a Server Action. */
    token,
    ready: !siteKey || token !== null,
    reset,
  }
}

"use client"

import Link from "next/link"
import { useEffect, useId, useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

import { saveCookieConsentAction } from "../actions"
import type { ConsentChoice } from "../consent"
import {
  closeCookieSettings,
  consentChanged,
  useConsent,
  useCookieSettingsOpen,
} from "./consent-store"
import { clearTrackingCookies, needsReloadFor } from "./trackers"

const CATEGORIES = [
  {
    key: "analytics",
    label: "Analytics",
    description:
      "Google Analytics: which pages and products people look at, so we can improve the shop.",
  },
  {
    key: "marketing",
    label: "Marketing",
    description:
      "Meta (Facebook and Instagram): measures our ads and shows them to people likely to care.",
  },
] as const

const button = "h-11 flex-1 rounded-none border-ink px-4 text-sm font-semibold"

/**
 * Cookie consent (owner decision 2026-10-16): Accept all, Reject all and
 * Choose, equally visible. Nothing but essential cookies until answered.
 * Not modal: the shop stays usable while it's open.
 */
export function ConsentBanner() {
  const consent = useConsent()
  const reopened = useCookieSettingsOpen()
  if (consent === undefined) return null
  if (consent !== null && !reopened) return null
  return (
    <Banner
      key={reopened ? "settings" : "first"}
      saved={consent}
      reopened={reopened}
    />
  )
}

function Banner({
  saved,
  reopened,
}: {
  saved: ConsentChoice | null
  reopened: boolean
}) {
  const id = useId()
  const [choosing, setChoosing] = useState(reopened)
  const [choice, setChoice] = useState<ConsentChoice>({
    analytics: saved?.analytics ?? false,
    marketing: saved?.marketing ?? false,
  })
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const heading = useRef<HTMLHeadingElement>(null)

  // Reopened from "Cookie settings": move focus to the panel.
  useEffect(() => {
    if (reopened) heading.current?.focus()
  }, [reopened])

  const save = (next: ConsentChoice) =>
    startTransition(async () => {
      const result = await saveCookieConsentAction({
        ...next,
        source: reopened ? "settings" : "banner",
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setError("")
      setChoosing(false)
      closeCookieSettings()
      if (needsReloadFor(next)) {
        // Scripts already running can't be unloaded: start clean.
        clearTrackingCookies()
        window.location.reload()
        return
      }
      if (!next.analytics || !next.marketing) clearTrackingCookies()
      consentChanged()
    })

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ink bg-paper p-4 text-ink shadow-[0_-8px_24px_rgb(0_0_0/0.12)] sm:inset-x-auto sm:bottom-4 sm:left-4 sm:max-w-md sm:border"
    >
      <div className="flex items-start justify-between gap-4">
        <h2
          id={`${id}-title`}
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          Cookies
        </h2>
        {reopened && (
          <button
            type="button"
            onClick={closeCookieSettings}
            className="text-sm underline underline-offset-4"
          >
            Close
          </button>
        )}
      </div>
      <p id={`${id}-text`} className="mt-1 text-sm">
        We use essential cookies to run the shop (your bag, sign-in and
        checkout). With your permission we&apos;d also use analytics and
        marketing cookies. You can change this any time from &ldquo;Cookie
        settings&rdquo; at the bottom of every page.{" "}
        <Link
          href="/policies/privacy-policy"
          className="underline underline-offset-4"
        >
          Privacy policy
        </Link>
      </p>
      {choosing && (
        <ul className="mt-3 flex flex-col gap-3 border-t pt-3 text-sm">
          <li className="flex items-start justify-between gap-4">
            <span>
              <span className="font-medium">Essential</span>
              <span className="block text-xs text-muted-foreground">
                Needed for the shop to work. Always on.
              </span>
            </span>
            <Switch
              checked
              disabled
              aria-label="Essential cookies (always on)"
            />
          </li>
          {CATEGORIES.map((category) => (
            <li
              key={category.key}
              className="flex items-start justify-between gap-4"
            >
              <label htmlFor={`${id}-${category.key}`}>
                <span className="font-medium">{category.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {category.description}
                </span>
              </label>
              <Switch
                id={`${id}-${category.key}`}
                checked={choice[category.key]}
                disabled={pending}
                onCheckedChange={(checked) =>
                  setChoice({ ...choice, [category.key]: checked })
                }
              />
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          className={button}
          disabled={pending}
          onClick={() => save({ analytics: false, marketing: false })}
        >
          Reject all
        </Button>
        {choosing ? (
          <Button
            variant="outline"
            className={button}
            disabled={pending}
            onClick={() => save(choice)}
          >
            Save choices
          </Button>
        ) : (
          <Button
            variant="outline"
            className={button}
            disabled={pending}
            onClick={() => setChoosing(true)}
          >
            Choose
          </Button>
        )}
        <Button
          variant="outline"
          className={button}
          disabled={pending}
          onClick={() => save({ analytics: true, marketing: true })}
        >
          Accept all
        </Button>
      </div>
    </div>
  )
}

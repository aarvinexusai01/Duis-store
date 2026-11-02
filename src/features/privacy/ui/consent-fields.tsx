"use client"

import type { Route } from "next"
import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"

import {
  CONSENT_TEXT,
  NOTICE_UI,
  PRIVACY_NOTICE_PATH,
  type ConsentPurpose,
  type NoticeLanguage,
} from "@/lib/privacy"
import { cn } from "@/lib/utils"

/**
 * DPDP consent boxes (doc/06 Phase 12): one unticked box per purpose, each
 * with its itemised notice, a link to the full Privacy Notice and an English
 * or Hindi choice (Act s.5(3)). The boxes are `required`, so a form can't be
 * sent without them; the server checks `consent` again.
 *
 * Forms that read FormData get `consent` ("true" once every box is ticked)
 * and `consentLanguage` fields; others use `onChange`. A single box carries
 * `consent` itself, so it also works before the page's JavaScript has loaded.
 */
export function ConsentFields({
  purposes,
  onChange,
  tone = "light",
  className,
}: {
  purposes: readonly ConsentPurpose[]
  onChange?: (allTicked: boolean, language: NoticeLanguage) => void
  /** "dark" on the black footer. */
  tone?: "dark" | "light"
  className?: string
}) {
  const id = useId()
  const [ticked, setTicked] = useState<ReadonlySet<ConsentPurpose>>(new Set())
  const [language, setLanguage] = useState<NoticeLanguage>("en")
  const all = purposes.every((purpose) => ticked.has(purpose))
  const ui = NOTICE_UI[language]
  const box = useRef<HTMLDivElement>(null)

  const toggle = (purpose: ConsentPurpose, on: boolean) => {
    const next = new Set(ticked)
    if (on) next.add(purpose)
    else next.delete(purpose)
    setTicked(next)
    onChange?.(
      purposes.every((p) => next.has(p)),
      language,
    )
  }
  // A box ticked before the page's JavaScript loaded still counts.
  useEffect(() => {
    box.current
      ?.querySelectorAll<HTMLInputElement>("input[data-consent]:checked")
      .forEach((input) => toggle(input.dataset.consent as ConsentPurpose, true))
    // Once, when the page becomes interactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchLanguage = () => {
    const next = language === "en" ? "hi" : "en"
    setLanguage(next)
    onChange?.(all, next)
  }

  return (
    <div
      ref={box}
      className={cn("flex flex-col gap-2 text-sm", className)}
      lang={language}
    >
      {purposes.map((purpose) => (
        <label
          key={purpose}
          htmlFor={`${id}-${purpose}`}
          className="flex items-start gap-2.5"
        >
          <input
            id={`${id}-${purpose}`}
            type="checkbox"
            required
            {...(purposes.length === 1
              ? { name: "consent", value: "true" }
              : {})}
            defaultChecked={false}
            onChange={(event) => toggle(purpose, event.target.checked)}
            onInvalid={(event) =>
              event.currentTarget.setCustomValidity(ui.required)
            }
            onInput={(event) => event.currentTarget.setCustomValidity("")}
            className={cn(
              "mt-0.5 size-4 shrink-0",
              tone === "dark" ? "accent-rust" : "accent-ink",
            )}
            data-consent={purpose}
          />
          <span>{CONSENT_TEXT[purpose][language]}</span>
        </label>
      ))}
      <p
        className={cn(
          "text-xs",
          tone === "dark" ? "text-chrome-muted" : "text-muted-foreground",
        )}
      >
        {ui.rights}{" "}
        <Link
          href={PRIVACY_NOTICE_PATH[language] as Route}
          target="_blank"
          className="underline underline-offset-2"
        >
          {ui.notice}
        </Link>
        .{" "}
        <button
          type="button"
          onClick={switchLanguage}
          className="underline underline-offset-2"
          lang={language === "en" ? "hi" : "en"}
        >
          {ui.switchTo}
        </button>
      </p>
      {purposes.length > 1 && all && (
        <input type="hidden" name="consent" value="true" />
      )}
      <input type="hidden" name="consentLanguage" value={language} />
    </div>
  )
}

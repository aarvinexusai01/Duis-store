import Link from "next/link"

import { SITE } from "@/config/site"
import { cn } from "@/lib/utils"

/**
 * The Duis brand mark: the hooded-skull logo and the DUIS wordmark, linking
 * home (owner decisions 2026-10-23, logo 2026-11-18). The logo scales with
 * the text size set through className. `tone` says what it sits on: the
 * store's header and footer are dark. Files come from
 * scripts/make-brand-assets.mjs.
 */
export function Wordmark({
  className,
  tone = "light",
}: {
  className?: string
  tone?: LogoTone
}) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-[0.3em] font-display text-3xl leading-none tracking-[0.06em] uppercase",
        className,
      )}
    >
      <Emblem tone={tone} className="h-[1.4em]" />
      {SITE.name}
      <span className="sr-only"> home</span>
    </Link>
  )
}

/** What the logo sits on: black hood on light, light hood on dark. */
export type LogoTone = "light" | "dark"

/** The logo's own proportions (it's taller than it is wide). */
const LOGO = { width: 642, height: 914 }

/** The logo on its own; decorative where the name is beside it. */
export function Emblem({
  className,
  tone = "light",
  alt = "",
}: {
  className?: string
  tone?: LogoTone
  alt?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed static asset, not catalogue media
    <img
      src={tone === "dark" ? "/brand/logo-on-dark.svg" : "/brand/logo.svg"}
      alt={alt}
      width={LOGO.width}
      height={LOGO.height}
      className={cn("w-auto shrink-0 object-contain", className)}
    />
  )
}

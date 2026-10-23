import Link from "next/link"

import { SITE } from "@/config/site"
import { cn } from "@/lib/utils"

/**
 * The Duis brand mark: the emblem and the DUIS wordmark, linking home
 * (owner decision 2026-10-23). The emblem scales with the text size set
 * through className. Files come from scripts/make-brand-assets.mjs.
 */
export function Wordmark({
  className,
  large = false,
}: {
  className?: string
  /** Bigger placements (footer, 404) use the sharper emblem file. */
  large?: boolean
}) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-[0.3em] font-display text-3xl leading-none tracking-[0.06em] uppercase",
        className,
      )}
    >
      <Emblem large={large} className="size-[1.3em]" />
      {SITE.name}
      <span className="sr-only"> home</span>
    </Link>
  )
}

/** The round emblem on its own; decorative where the name is beside it. */
export function Emblem({
  className,
  large = false,
  alt = "",
}: {
  className?: string
  large?: boolean
  alt?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed static asset, not catalogue media
    <img
      src={large ? "/brand/emblem-256.webp" : "/brand/emblem-96.webp"}
      alt={alt}
      width={large ? 256 : 96}
      height={large ? 256 : 96}
      className={cn("shrink-0 object-contain", className)}
    />
  )
}

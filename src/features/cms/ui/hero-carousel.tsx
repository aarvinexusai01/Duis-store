"use client"

import { PauseIcon, PlayIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/** How long each hero slide shows (owner decision 2026-10-22). */
const INTERVAL_MS = 3_000

/**
 * The home page hero's slides, moving on their own every 3 seconds and
 * looping (owner decision 2026-10-22). The slides themselves are rendered on
 * the server; this only moves the scroll strip.
 *
 * It holds still while a shopper is reading or acting: pointer over it, a
 * finger on it, keyboard focus inside it, the tab in the background, the
 * pause button, or "reduce motion" in their device settings. The dots and
 * the pause button follow the W3C carousel pattern (WCAG 2.2.2).
 */
export function HeroCarousel({
  count,
  label,
  children,
}: {
  count: number
  label: string
  children: ReactNode
}) {
  const strip = useRef<HTMLUListElement>(null)
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const [holding, setHolding] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [hidden, setHidden] = useState(false)

  const goTo = useCallback((index: number) => {
    const el = strip.current
    if (!el) return
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" })
  }, [])

  // Which slide is showing, however it got there (timer, dot, swipe).
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const onScroll = () => {
      if (el.clientWidth > 0)
        setCurrent(Math.round(el.scrollLeft / el.clientWidth))
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(motion.matches)
    update()
    motion.addEventListener("change", update)
    const visibility = () => setHidden(document.hidden)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      motion.removeEventListener("change", update)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])

  const moving = count > 1 && !paused && !holding && !reducedMotion && !hidden

  // Restarts after every slide change, so a swipe or a dot gets a full 3 s.
  useEffect(() => {
    if (!moving) return
    const timer = window.setTimeout(
      () => goTo((current + 1) % count),
      INTERVAL_MS,
    )
    return () => window.clearTimeout(timer)
  }, [moving, current, count, goTo])

  return (
    <div
      className="relative"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHolding(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHolding(false)}
      onTouchStart={() => setHolding(true)}
      onTouchEnd={() => setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setHolding(false)
      }}
    >
      <ul
        ref={strip}
        tabIndex={0}
        aria-label={label}
        // Screen readers hear slide changes only when they aren't automatic.
        aria-live={moving ? "off" : "polite"}
        className="flex snap-x snap-mandatory overflow-x-auto"
      >
        {children}
      </ul>
      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 sm:bottom-5">
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Play slideshow" : "Pause slideshow"}
          className="flex size-7 items-center justify-center rounded-full bg-ink/40 text-paper backdrop-blur-sm hover:bg-ink/60"
        >
          {paused ? (
            <PlayIcon className="size-3.5" aria-hidden />
          ) : (
            <PauseIcon className="size-3.5" aria-hidden />
          )}
        </button>
        {Array.from({ length: count }, (_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => goTo(index)}
            aria-label={`Show slide ${index + 1} of ${count}`}
            aria-current={index === current ? "true" : undefined}
            className="flex size-7 items-center justify-center"
          >
            <span
              className={cn(
                "block h-1.5 rounded-full bg-paper/60 shadow-sm transition-all",
                index === current ? "w-6 bg-paper" : "w-1.5",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

"use client"

/**
 * Adapted from page-mascot 0.1.0 (https://github.com/nilbuild/page-mascot).
 * MIT License, Copyright (c) 2026 Kamran Ahmed <https://kamran.fyi>.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software, to deal in it without restriction, provided this notice is
 * kept. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * Changes for Duis: a `mood` prop holds an expression set by code (the
 * original only reacts to clicks), extra button props pass through so it can
 * be a popover trigger, and styling uses Tailwind classes.
 */

import { useEffect, useRef, useState, type ComponentProps } from "react"

import { cn } from "@/lib/utils"

const DIRECTIONS = [
  "up-left",
  "up",
  "up-right",
  "left",
  "center",
  "right",
  "down-left",
  "down",
  "down-right",
] as const

export const MOODS = [
  "blink",
  "heart",
  "sparkle",
  "surprised",
  "wink",
  "bashful",
  "sleepy",
  "dizzy",
  "delighted",
] as const

type Direction = (typeof DIRECTIONS)[number]
export type Mood = (typeof MOODS)[number]

// Clockwise from the right, matching atan2 with y pointing down.
const CLOCKWISE: Direction[] = [
  "right",
  "down-right",
  "down",
  "down-left",
  "left",
  "up-left",
  "up",
  "up-right",
]
const SECTOR = (Math.PI * 2) / CLOCKWISE.length
const HYSTERESIS = 0.12
const DEAD_ZONE = 70
const PAYOFFS: Mood[] = ["heart", "sparkle", "delighted"]
const BOOP_PAYOFF = 120
const BOOP_END = 560
const SQUASH_MS = 420
const DIZZY_AFTER = 4
const DIZZY_WINDOW = 1600
const DIZZY_END = 1100
const SQUASH: Keyframe[] = [
  { transform: "scale(1, 1)", easing: "ease-in" },
  { transform: "scale(1.10, 0.86)", offset: 0.18, easing: "ease-out" },
  { transform: "scale(0.95, 1.08)", offset: 0.45, easing: "ease-in-out" },
  { transform: "scale(1.03, 0.97)", offset: 0.72, easing: "ease-in-out" },
  { transform: "scale(1, 1)" },
]

// background-size 300% makes each cell a clean 0/50/100% step on both axes.
function cell(index: number) {
  return {
    backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%`,
  }
}

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** Bounce the cat once (respects reduced motion). */
export function squash(element: HTMLElement | null) {
  if (!element || reducedMotion()) return
  // Per-keyframe easing with the effect itself linear: an easing on the effect
  // would reinterpret every offset and front-load the whole bounce.
  element.animate(SQUASH, { duration: SQUASH_MS, easing: "linear" })
}

export type MascotProps = Omit<ComponentProps<"button">, "children"> & {
  /** The 3x3 sheet of head directions. */
  directions: string
  /** The 3x3 sheet of expressions. */
  reactions: string
  /** px, square. */
  size?: number
  /** An expression held until it changes back to null. */
  mood?: Mood | null
  /** Classes for the drawing inside the button (e.g. to let it overflow). */
  artClassName?: string
}

export function Mascot({
  directions,
  reactions,
  size = 140,
  mood = null,
  artClassName,
  className,
  style,
  onClick,
  ref,
  ...button
}: MascotProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const squashRef = useRef<HTMLSpanElement>(null)
  const timersRef = useRef<number[]>([])
  const boopsRef = useRef({ count: 0, at: 0 })
  const [direction, setDirection] = useState<Direction>("center")
  const [boopMood, setBoopMood] = useState<Mood | null>(null)

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return
    }
    let sector = -1
    let pointer: { x: number; y: number } | null = null
    const aim = () => {
      const target = buttonRef.current
      if (!target || !pointer) return
      const box = target.getBoundingClientRect()
      const dx = pointer.x - (box.left + box.width / 2)
      const dy = pointer.y - (box.top + box.height / 2)
      if (Math.hypot(dx, dy) < DEAD_ZONE) {
        sector = -1
        setDirection("center")
        return
      }
      // Hold the current sector until the pointer is well past its edge.
      const angle = Math.atan2(dy, dx)
      if (
        sector !== -1 &&
        Math.abs(wrap(angle - sector * SECTOR)) < SECTOR / 2 + HYSTERESIS
      ) {
        return
      }
      sector =
        (Math.round(angle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length
      setDirection(CLOCKWISE[sector]!)
    }
    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
      aim()
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("scroll", aim, { passive: true })
    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("scroll", aim)
    }
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach(window.clearTimeout)
  }, [])

  // A mood set by code bounces the cat once, so the change is noticed.
  useEffect(() => {
    if (mood && mood !== "sleepy") squash(squashRef.current)
  }, [mood])

  const boop = () => {
    timersRef.current.forEach(window.clearTimeout)
    timersRef.current = []
    const later = (ms: number, next: Mood | null) => {
      timersRef.current.push(window.setTimeout(() => setBoopMood(next), ms))
    }
    const now = Date.now()
    const boops = boopsRef.current
    boops.count = now - boops.at < DIZZY_WINDOW ? boops.count + 1 : 1
    boops.at = now
    if (boops.count >= DIZZY_AFTER) {
      boops.count = 0
      setBoopMood("dizzy")
      later(DIZZY_END, null)
    } else {
      setBoopMood("blink")
      later(BOOP_PAYOFF, PAYOFFS[(boops.count - 1) % PAYOFFS.length]!)
      later(BOOP_END, null)
    }
    squash(squashRef.current)
  }

  const shown = boopMood ?? mood
  const layer = "absolute inset-0 bg-no-repeat [background-size:300%_300%]"

  return (
    <button
      ref={(node) => {
        buttonRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      type="button"
      data-mood={shown ?? "none"}
      {...button}
      onClick={(event) => {
        boop()
        onClick?.(event)
      }}
      className={cn(
        "relative block shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 select-none",
        className,
      )}
      style={{ width: size, height: size, ...style }}
    >
      <span
        ref={squashRef}
        className={cn(
          "relative block size-full origin-[50%_78%]",
          artClassName,
        )}
      >
        <span
          aria-hidden
          className={layer}
          style={{
            backgroundImage: `url(${directions})`,
            ...cell(DIRECTIONS.indexOf(direction)),
            opacity: shown ? 0 : 1,
          }}
        />
        <span
          aria-hidden
          className={layer}
          style={{
            backgroundImage: `url(${reactions})`,
            ...cell(MOODS.indexOf(shown ?? "blink")),
            opacity: shown ? 1 : 0,
          }}
        />
      </span>
    </button>
  )
}

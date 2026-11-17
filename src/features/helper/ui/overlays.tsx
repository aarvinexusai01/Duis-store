"use client"

import { XIcon } from "lucide-react"
import { useEffect, useState, type ReactNode, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { HELPER_NAME } from "../tips"
import type { Saying } from "./say"
import { findFirst } from "./tour-steps"

/**
 * What the helper shows over the page: the blocking tours (welcome and page
 * tours), the walkthrough that leaves the page usable, and speech bubbles.
 * All speak from a bubble above the cat in the corner.
 */

const PAD = 6

/** Follows the first visible match as the page scrolls or resizes. */
export function useTargetBox(
  targets: readonly string[] | null,
  scroll = true,
): DOMRect | null {
  const [box, setBox] = useState<DOMRect | null>(null)
  const key = targets?.join("|") ?? ""
  useEffect(() => {
    if (!key) return
    const selectors = key.split("|")
    let scrolled = !scroll
    let frame = 0
    const measure = () => {
      // The target may appear later (a tab opening, a list loading).
      const target = findFirst(selectors)
      if (target && !scrolled) {
        target.scrollIntoView({ block: "nearest", inline: "nearest" })
        scrolled = true
      }
      const next = target ? target.getBoundingClientRect() : null
      setBox((previous) =>
        previous &&
        next &&
        previous.top === next.top &&
        previous.left === next.left &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      )
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    return () => window.cancelAnimationFrame(frame)
  }, [key, scroll])
  return key ? box : null
}

/** An outline around the target; with `dim`, the rest of the page darkens. */
function Spotlight({ box, dim }: { box: DOMRect; dim?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed rounded-md transition-all duration-200 motion-reduce:transition-none",
        dim ? "ring-2 ring-paper" : "z-[55] ring-[3px] ring-rust",
      )}
      style={{
        top: box.top - PAD,
        left: box.left - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
        ...(dim ? { boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.5)" } : {}),
      }}
    />
  )
}

/** The speech bubble above the cat, with a tail pointing down at it. */
function Bubble({
  children,
  label,
  labelledBy,
  describedBy,
  modal,
}: {
  children: ReactNode
  label?: string
  labelledBy?: string
  describedBy?: string
  modal?: boolean
}) {
  return (
    <div
      role="dialog"
      aria-modal={modal ? "true" : "false"}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="fixed right-3 bottom-[5.25rem] z-[70] w-[min(22rem,calc(100vw-1.5rem))] rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 md:right-5 md:bottom-24"
    >
      <span
        aria-hidden
        className="absolute right-6 -bottom-1.5 size-3 rotate-45 bg-popover ring-1 ring-foreground/10 [clip-path:polygon(100%_0,100%_100%,0_100%)] md:right-7"
      />
      {children}
    </div>
  )
}

type StepProps = {
  title: string
  body: string
  index: number
  total: number
  nextRef: RefObject<HTMLButtonElement | null>
  onBack: () => void
  onNext: () => void
  onStop: () => void
}

/** A tour that blocks the page: welcome tour and page tours. */
export function TourOverlay({
  box,
  stopLabel = "Skip tour",
  ...step
}: StepProps & { box: DOMRect | null; stopLabel?: string }) {
  return (
    <>
      {/* Blocks the page behind the tour; the spotlight is only a picture. */}
      <div className="fixed inset-0 z-[60]" aria-hidden>
        {box ? (
          <Spotlight box={box} dim />
        ) : (
          <div className="fixed inset-0 bg-black/50" />
        )}
      </div>
      <Bubble
        modal
        labelledBy="helper-tour-title"
        describedBy="helper-tour-body"
      >
        <StepBody {...step} stopLabel={stopLabel} last="Done" />
      </Bubble>
    </>
  )
}

/**
 * The product walkthrough: the page stays usable, the next thing to do is
 * outlined, and the bubble moves on by itself when it's done.
 */
export function GuideOverlay({
  box,
  ...step
}: StepProps & { box: DOMRect | null }) {
  return (
    <>
      {box && <Spotlight box={box} />}
      <Bubble labelledBy="helper-tour-title" describedBy="helper-tour-body">
        <StepBody {...step} stopLabel="Stop" last="Finish" />
      </Bubble>
    </>
  )
}

function StepBody({
  title,
  body,
  index,
  total,
  nextRef,
  onBack,
  onNext,
  onStop,
  stopLabel,
  last,
}: StepProps & { stopLabel: string; last: string }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Step {index + 1} of {total}
      </p>
      <h2 id="helper-tour-title" className="mt-1 font-medium">
        {title}
      </h2>
      <p id="helper-tour-body" className="mt-1">
        {body}
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onStop}>
          {stopLabel}
        </Button>
        <div className="ml-auto flex gap-2">
          {index > 0 && (
            <Button size="sm" variant="outline" onClick={onBack}>
              Back
            </Button>
          )}
          <Button ref={nextRef} size="sm" onClick={onNext}>
            {index + 1 >= total ? last : "Next"}
          </Button>
        </div>
      </div>
    </>
  )
}

/** A short message from the helper, e.g. an offer or a warning. */
export function SayingBubble({
  saying,
  onClose,
}: {
  saying: Saying
  onClose: (choice: number | null) => void
}) {
  const box = useTargetBox(saying.target ? [saying.target] : null)
  return (
    <>
      {box && <Spotlight box={box} />}
      <Bubble label={`${HELPER_NAME} says`}>
        <button
          type="button"
          onClick={() => onClose(null)}
          className="absolute top-2 right-2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="Close"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
        <p className="pr-6">{saying.text}</p>
        {saying.actions && saying.actions.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {saying.actions.map((action, index) => (
              <Button
                key={action.label}
                size="sm"
                variant={index === 0 ? "default" : "ghost"}
                onClick={() => onClose(index)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </Bubble>
    </>
  )
}

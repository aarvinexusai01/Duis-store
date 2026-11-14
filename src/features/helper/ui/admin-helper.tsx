"use client"

import { CheckIcon, CircleHelpIcon, EyeOffIcon, MapIcon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import {
  completeTourAction,
  getHelperStateAction,
  setHelperHiddenAction,
} from "../actions"
import type { ChecklistItem, HelperState } from "../service"
import { HELPER_NAME, tipsFor } from "../tips"
import { Mascot, type Mood } from "./mascot"
import { availableSteps, findTarget, type TourStep } from "./tour-steps"

const SHEETS = {
  directions: "/mascots/cat-directions.webp",
  reactions: "/mascots/cat-reactions.webp",
}

/** How long a reaction to a save or error stays on the cat's face. */
const REACTION_MS = 1800
/** No pointer, key or scroll activity for this long and the cat dozes off. */
export const IDLE_MS = 2 * 60 * 1000
const CHEERS: Mood[] = ["sparkle", "delighted", "heart"]

/** The cat's face for a toast type, or null to ignore it. */
export function moodForToast(type: string | null): Mood | null {
  if (type === "success") return "sparkle"
  if (type === "error") return "dizzy"
  if (type === "warning") return "surprised"
  return null
}

/**
 * Reacts to the admin's own save and error messages (sonner toasts), so no
 * page has to tell the helper what happened.
 */
function useToastMood(): Mood | null {
  const [mood, setMood] = useState<Mood | null>(null)

  useEffect(() => {
    const seen = new WeakMap<Element, string>()
    let cheer = 0
    let timer = 0
    const react = (toastElement: Element) => {
      const type = toastElement.getAttribute("data-type")
      if (!type || seen.get(toastElement) === type) return
      seen.set(toastElement, type)
      let next = moodForToast(type)
      if (!next) return
      if (next === "sparkle") next = CHEERS[cheer++ % CHEERS.length]!
      setMood(next)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setMood(null), REACTION_MS)
    }
    const root =
      document.querySelector('section[aria-label^="Notifications"]') ??
      document.body
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          react(record.target as Element)
          continue
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches("[data-sonner-toast]")) react(node)
          else node.querySelectorAll("[data-sonner-toast]").forEach(react)
        }
      }
    })
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-type"],
    })
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  return mood
}

function useIdle(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = 0
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), IDLE_MS)
    }
    const events = ["pointermove", "pointerdown", "keydown", "scroll"]
    events.forEach((name) =>
      window.addEventListener(name, wake, { passive: true }),
    )
    wake()
    return () => {
      events.forEach((name) => window.removeEventListener(name, wake))
      window.clearTimeout(timer)
    }
  }, [])
  return idle
}

/** Follows the highlighted element as the page scrolls or resizes. */
function useTargetBox(step: TourStep | null): DOMRect | null {
  const [box, setBox] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (!step) return
    const target = findTarget(step)
    target?.scrollIntoView({ block: "nearest", inline: "nearest" })
    let frame = 0
    const measure = () => {
      setBox(target ? target.getBoundingClientRect() : null)
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    return () => window.cancelAnimationFrame(frame)
  }, [step])
  return step ? box : null
}

export function AdminHelper({ initial }: { initial: HelperState }) {
  const pathname = usePathname()
  const page = tipsFor(pathname)
  const [hidden, setHidden] = useState(initial.hidden)
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState<{
    from: ChecklistItem[]
    items: ChecklistItem[]
  } | null>(null)
  const checklist =
    fresh && fresh.from === initial.checklist ? fresh.items : initial.checklist
  const [tour, setTour] = useState<{ steps: TourStep[]; index: number } | null>(
    null,
  )
  const [, startTransition] = useTransition()
  const toastMood = useToastMood()
  const idle = useIdle()
  const step = tour ? (tour.steps[tour.index] ?? null) : null
  const box = useTargetBox(step)
  const nextRef = useRef<HTMLButtonElement>(null)

  const mood: Mood | null =
    step?.mood ?? toastMood ?? (idle && !open ? "sleepy" : null)

  const startTour = () => {
    setOpen(false)
    setTour({ steps: availableSteps(), index: 0 })
  }

  // First visit: a short pause so the page settles before the tour starts.
  useEffect(() => {
    if (initial.tourDone || initial.hidden) return
    const timer = window.setTimeout(() => {
      setTour({ steps: availableSteps(), index: 0 })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [initial.tourDone, initial.hidden])

  useEffect(() => {
    if (step) nextRef.current?.focus()
  }, [step])

  const endTour = () => {
    setTour(null)
    startTransition(async () => {
      await completeTourAction()
    })
  }

  useEffect(() => {
    if (!tour) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        endTour()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tour])

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    startTransition(async () => {
      const result = await getHelperStateAction()
      if (result.ok) {
        setFresh({ from: initial.checklist, items: result.state.checklist })
      }
    })
  }

  const setHiddenSaved = (value: boolean) => {
    setHidden(value)
    setOpen(false)
    startTransition(async () => {
      const result = await setHelperHiddenAction(value)
      if (!result.ok) {
        setHidden(!value)
        toast.error(result.message)
      }
    })
  }

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHiddenSaved(false)}
        className="fixed right-0 bottom-6 z-40 flex items-center gap-1 rounded-l-full border border-r-0 bg-card py-1.5 pr-2 pl-2.5 text-xs text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`Show the helper, ${HELPER_NAME}`}
      >
        <CircleHelpIcon aria-hidden className="size-4" />
        <span className="hidden sm:inline">Help</span>
      </button>
    )
  }

  const done = checklist.filter((item) => item.done).length

  return (
    <>
      {step && (
        <TourOverlay
          step={step}
          box={box}
          index={tour!.index}
          total={tour!.steps.length}
          nextRef={nextRef}
          onBack={() =>
            setTour((t) => t && { ...t, index: Math.max(0, t.index - 1) })
          }
          onNext={() =>
            tour!.index + 1 >= tour!.steps.length
              ? endTour()
              : setTour((t) => t && { ...t, index: t.index + 1 })
          }
          onSkip={endTour}
        />
      )}
      <div
        className={cn(
          "fixed right-3 bottom-3 md:right-5 md:bottom-5",
          step ? "z-[70]" : "z-40",
        )}
      >
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger
            disabled={!!step}
            render={
              <Mascot
                directions={SHEETS.directions}
                reactions={SHEETS.reactions}
                size={64}
                mood={mood}
                data-tour="helper"
                aria-label={`Help from ${HELPER_NAME}: tips for this page`}
                className="size-14 rounded-full bg-card shadow-md ring-1 ring-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:size-16"
                artClassName="absolute -inset-2.5 size-auto"
                style={{ width: undefined, height: undefined }}
              />
            }
          />
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-[min(22rem,calc(100vw-1.5rem))] gap-3 p-3"
          >
            <div>
              <p className="font-medium">{page.title}</p>
              <p className="text-xs text-muted-foreground">
                {HELPER_NAME} the helper cat
              </p>
            </div>
            <Tabs defaultValue="page">
              {checklist.length > 0 && (
                <TabsList className="w-full">
                  <TabsTrigger value="page">This page</TabsTrigger>
                  <TabsTrigger value="start">
                    Getting started {done}/{checklist.length}
                  </TabsTrigger>
                </TabsList>
              )}
              <TabsContent value="page">
                <ul className="flex flex-col gap-2 pt-1">
                  {page.tips.map((tip) => (
                    <li key={tip} className="flex gap-2 text-sm">
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40"
                      />
                      {tip}
                    </li>
                  ))}
                </ul>
              </TabsContent>
              {checklist.length > 0 && (
                <TabsContent value="start">
                  <Checklist
                    items={checklist}
                    onNavigate={() => setOpen(false)}
                  />
                </TabsContent>
              )}
            </Tabs>
            <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
              <Button size="sm" variant="ghost" onClick={startTour}>
                <MapIcon aria-hidden />
                Show me around
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHiddenSaved(true)}
              >
                <EyeOffIcon aria-hidden />
                Hide helper
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}

function Checklist({
  items,
  onNavigate,
}: {
  items: ChecklistItem[]
  onNavigate: () => void
}) {
  const done = items.filter((item) => item.done).length
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label="Getting started"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={done}
      >
        <div
          className="h-full bg-foreground transition-[width]"
          style={{ width: `${(done / items.length) * 100}%` }}
        />
      </div>
      {done === items.length && <p className="text-sm">All done. Nice work!</p>}
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href as Route}
              onClick={onNavigate}
              className="flex gap-2 rounded-sm p-1.5 hover:bg-secondary"
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  item.done &&
                    "border-foreground bg-foreground text-background",
                )}
              >
                {item.done && <CheckIcon aria-hidden className="size-3" />}
              </span>
              <span className="flex flex-col">
                <span
                  className={cn(
                    "text-sm",
                    item.done && "text-muted-foreground line-through",
                  )}
                >
                  {item.label}
                  <span className="sr-only">
                    {item.done ? " (done)" : " (to do)"}
                  </span>
                </span>
                {!item.done && (
                  <span className="text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TourOverlay({
  step,
  box,
  index,
  total,
  nextRef,
  onBack,
  onNext,
  onSkip,
}: {
  step: TourStep
  box: DOMRect | null
  index: number
  total: number
  nextRef: RefObject<HTMLButtonElement | null>
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}) {
  const last = index + 1 >= total
  const pad = 6
  return (
    <>
      {/* Blocks the page behind the tour; the spotlight is only a picture. */}
      <div className="fixed inset-0 z-[60]" aria-hidden>
        {box ? (
          <div
            className="pointer-events-none fixed rounded-md ring-2 ring-paper transition-all duration-200 motion-reduce:transition-none"
            style={{
              top: box.top - pad,
              left: box.left - pad,
              width: box.width + pad * 2,
              height: box.height + pad * 2,
              boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.5)",
            }}
          />
        ) : (
          <div className="fixed inset-0 bg-black/50" />
        )}
      </div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="helper-tour-title"
        aria-describedby="helper-tour-body"
        className="fixed right-3 bottom-[5.25rem] z-[70] w-[min(22rem,calc(100vw-1.5rem))] rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 md:right-5 md:bottom-24"
      >
        {/* A tail pointing down at the cat, so the bubble reads as its words. */}
        <span
          aria-hidden
          className="absolute right-6 -bottom-1.5 size-3 rotate-45 bg-popover ring-1 ring-foreground/10 [clip-path:polygon(100%_0,100%_100%,0_100%)] md:right-7"
        />
        <p className="text-xs text-muted-foreground">
          Step {index + 1} of {total}
        </p>
        <h2 id="helper-tour-title" className="mt-1 font-medium">
          {step.title}
        </h2>
        <p id="helper-tour-body" className="mt-1">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Skip tour
          </Button>
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <Button size="sm" variant="outline" onClick={onBack}>
                Back
              </Button>
            )}
            <Button ref={nextRef} size="sm" onClick={onNext}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

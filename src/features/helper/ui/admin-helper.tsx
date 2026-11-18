"use client"

import {
  BookOpenIcon,
  CheckIcon,
  CircleHelpIcon,
  EyeOffIcon,
  MapIcon,
  ShirtIcon,
  SparklesIcon,
} from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
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
  markGuideSeenAction,
  setHelperHiddenAction,
} from "../actions"
import type { ChecklistItem, HelperState, TodoItem } from "../service"
import { HELPER_NAME, patternFor, tipsFor } from "../tips"
import { Mascot, type Mood } from "./mascot"
import {
  GuideOverlay,
  SayingBubble,
  TourOverlay,
  useTargetBox,
} from "./overlays"
import { PAGE_TOURS, pageTour } from "./page-tours"
import { onHelperSay, onStartProductWalkthrough, type Saying } from "./say"
import { availableSteps, type TourStep } from "./tour-steps"
import { WALKTHROUGH, WALKTHROUGH_KEY, walkthroughPage } from "./walkthrough"

const SHEETS = {
  directions: "/mascots/cat-directions.webp",
  reactions: "/mascots/cat-reactions.webp",
}

/** How long a reaction to a save or error stays on the cat's face. */
const REACTION_MS = 1800
/** No pointer, key or scroll activity for this long and the cat dozes off. */
export const IDLE_MS = 2 * 60 * 1000
/** A message without buttons closes itself after this long. */
const SAYING_MS = 8000
/** Offers wait this long after a page opens, so it can settle first. */
const OFFER_DELAY_MS = 900
const CHEERS: Mood[] = ["sparkle", "delighted", "heart"]

/** Where an unfinished walkthrough is kept across a full page reload. */
const GUIDE_STORAGE = "duis:helper-walkthrough"
type GuideState = { index: number; productId: string | null }

function readStoredGuide(): GuideState | null {
  try {
    const raw = window.sessionStorage.getItem(GUIDE_STORAGE)
    const value = raw ? (JSON.parse(raw) as GuideState) : null
    return value && Number.isInteger(value.index) ? value : null
  } catch {
    return null
  }
}

function storeGuide(state: GuideState | null) {
  try {
    if (state)
      window.sessionStorage.setItem(GUIDE_STORAGE, JSON.stringify(state))
    else window.sessionStorage.removeItem(GUIDE_STORAGE)
  } catch {
    // Private mode: the walkthrough just doesn't survive a reload.
  }
}

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

type Tour = { kind: "welcome" | "page"; steps: TourStep[]; index: number }
/** An offer belongs to the page it was made on. */
type Shown = Saying & { path?: string }

export function AdminHelper({ initial }: { initial: HelperState }) {
  const pathname = usePathname()
  const router = useRouter()
  const pattern = patternFor(pathname)
  const page = tipsFor(pathname)
  const [hidden, setHidden] = useState(initial.hidden)
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState<{
    from: HelperState
    state: HelperState
  } | null>(null)
  const current = fresh && fresh.from === initial ? fresh.state : initial
  const [seen, setSeen] = useState(() => new Set(initial.seenGuides))
  const [tour, setTour] = useState<Tour | null>(null)
  const [guide, setGuide] = useState<GuideState | null>(null)
  const [saying, setSaying] = useState<Shown | null>(null)
  // No offers on the page where the welcome tour just ended.
  const [quietPath, setQuietPath] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const toastMood = useToastMood()
  const idle = useIdle()
  const nextRef = useRef<HTMLButtonElement>(null)

  const canAddProducts = initial.checklist.some(
    (item) => item.key === "product",
  )
  const hasPageTour = !!pattern && pattern in PAGE_TOURS

  const tourStep = tour ? (tour.steps[tour.index] ?? null) : null
  const tourBox = useTargetBox(tourStep ? tourStep.targets : null)

  const where = walkthroughPage(pathname)
  const guideStep = guide ? (WALKTHROUGH[guide.index] ?? null) : null
  const guideHere =
    !!guideStep &&
    !!where &&
    guideStep.page === where.page &&
    (where.page !== "edit" ||
      !guide!.productId ||
      guide!.productId === where.productId)
  const guideBox = useTargetBox(guideHere ? [guideStep.target] : null)

  const shown =
    saying && (!saying.path || saying.path === pathname) ? saying : null

  const mood: Mood | null =
    tourStep?.mood ??
    (guideHere ? guideStep.mood : null) ??
    shown?.mood ??
    toastMood ??
    (idle && !open ? "sleepy" : null)

  const refresh = () =>
    startTransition(async () => {
      const result = await getHelperStateAction()
      if (result.ok) setFresh({ from: initial, state: result.state })
    })

  const markSeen = (key: string) => {
    setSeen((previous) => new Set(previous).add(key))
    startTransition(async () => {
      await markGuideSeenAction(key)
    })
  }

  // ── Tours that block the page ──────────────────────────────────────────
  const startWelcome = () => {
    setOpen(false)
    setSaying(null)
    setTour({ kind: "welcome", steps: availableSteps(), index: 0 })
  }

  const startPageTour = () => {
    const steps = availableSteps(pageTour(pattern, page.title))
    if (steps.length === 0) return
    setOpen(false)
    setSaying(null)
    if (pattern) markSeen(`page:${pattern}`)
    setTour({ kind: "page", steps, index: 0 })
  }

  const endTour = () => {
    if (tour?.kind === "welcome") {
      setQuietPath(pathname)
      startTransition(async () => {
        await completeTourAction()
      })
    }
    setTour(null)
  }

  // First visit: a short pause so the page settles before the tour starts.
  useEffect(() => {
    if (initial.tourDone || initial.hidden) return
    const timer = window.setTimeout(() => {
      setTour({ kind: "welcome", steps: availableSteps(), index: 0 })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [initial.tourDone, initial.hidden])

  useEffect(() => {
    if (tourStep) nextRef.current?.focus()
  }, [tourStep])

  // Escape ends a tour. Listened for while capturing, so nothing on the page
  // that handles Escape itself (and stops it there) can swallow it.
  useEffect(() => {
    if (!tour) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        endTour()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  })

  // ── The product walkthrough ────────────────────────────────────────────
  const setGuideSaved = (state: GuideState | null) => {
    setGuide(state)
    storeGuide(state)
  }

  const startGuide = () => {
    setOpen(false)
    setSaying(null)
    setGuideSaved({ index: 0, productId: null })
    if (walkthroughPage(pathname)?.page !== "new") {
      router.push("/admin/products/new" as Route)
    }
  }

  const finishGuide = (completed: boolean) => {
    setGuideSaved(null)
    if (completed) markSeen(WALKTHROUGH_KEY)
    setSaying(
      completed
        ? {
            id: "walkthrough-done",
            text: "That's it! Your product is ready to sell. Add the next one the same way, or ask me again from my menu.",
            mood: "heart",
          }
        : {
            id: "walkthrough-stopped",
            text: "Stopped. You can start the walkthrough again from my menu.",
            mood: "wink",
          },
    )
  }

  const goGuide = (index: number) => {
    if (!guide) return
    if (index >= WALKTHROUGH.length) return finishGuide(true)
    const here = walkthroughPage(window.location.pathname)
    setGuideSaved({
      index: Math.max(0, index),
      productId:
        guide.productId ?? (here?.page === "edit" ? here.productId : null),
    })
  }

  // A reload keeps an unfinished walkthrough (it lives in this tab only).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readStoredGuide()
      if (stored) setGuide(stored)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  // Each step moves on by itself once it's done. The step that saves the
  // new product is checked on the next page, where it lands.
  useEffect(() => {
    if (!guide || !guideStep?.done) return
    const crossing = guideStep.page === "new" && where?.page === "edit"
    if (!guideHere && !crossing) return
    const check = guideStep.done
    const timer = window.setInterval(() => {
      if (check(window.location.pathname)) goGuide(guide.index + 1)
    }, 300)
    return () => window.clearInterval(timer)
  })

  // ── Offers: the walkthrough, and a tour of a page seen for the first time
  useEffect(() => {
    if (hidden || tour || guide || (!initial.tourDone && !quietPath)) return
    if (pathname === quietPath) return
    const timer = window.setTimeout(() => {
      if (walkthroughPage(pathname)?.page === "new") {
        if (!canAddProducts || seen.has(WALKTHROUGH_KEY)) return
        setSaying({
          id: "offer:walkthrough",
          path: pathname,
          text: "Adding a product? I can walk you through it, one step at a time.",
          mood: "delighted",
          actions: [
            { label: "Walk me through", run: startGuide },
            { label: "No thanks", run: () => markSeen(WALKTHROUGH_KEY) },
          ],
          onDismiss: () => markSeen(WALKTHROUGH_KEY),
        })
        return
      }
      const key = `page:${pattern}`
      if (!pattern || seen.has(key)) return
      if (availableSteps(pageTour(pattern, page.title)).length < 2) return
      setSaying({
        id: "offer:tour",
        path: pathname,
        text: `First time on ${page.title}? Want a quick tour of this page?`,
        mood: "wink",
        actions: [
          { label: "Show me", run: startPageTour },
          { label: "Not now", run: () => markSeen(key) },
        ],
        onDismiss: () => markSeen(key),
      })
    }, OFFER_DELAY_MS)
    return () => window.clearTimeout(timer)
    // Offered once per page visit, not again on every render: the rest is
    // derived from the path or read when the offer is accepted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, hidden, tour, guide, quietPath, seen])

  // Messages from pages (helperSay), e.g. the product health check.
  useEffect(
    () =>
      onHelperSay((next) => {
        if (!hidden && !tour) setSaying(next)
      }),
    [hidden, tour],
  )

  useEffect(() => {
    if (!saying || saying.actions?.length) return
    const timer = window.setTimeout(() => setSaying(null), SAYING_MS)
    return () => window.clearTimeout(timer)
  }, [saying])

  const closeSaying = (choice: number | null) => {
    const closing = saying
    setSaying(null)
    if (!closing) return
    if (choice === null) closing.onDismiss?.()
    else closing.actions?.[choice]?.run?.()
  }

  // The to-do list and checklist follow the work done on each page.
  const firstPath = useRef(pathname)
  useEffect(() => {
    if (pathname === firstPath.current) return
    firstPath.current = pathname
    refresh()
    // Once per page change; refresh is a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) refresh()
  }

  const setHiddenSaved = (value: boolean) => {
    setHidden(value)
    setOpen(false)
    setSaying(null)
    startTransition(async () => {
      const result = await setHelperHiddenAction(value)
      if (!result.ok) {
        setHidden(!value)
        toast.error(result.message)
      }
    })
  }

  // "Start the walkthrough" on the written guide (shows the helper if hidden).
  useEffect(() =>
    onStartProductWalkthrough(() => {
      if (hidden) setHiddenSaved(false)
      startGuide()
    }),
  )

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

  const checklist = current.checklist
  const todos = current.todos
  const todoCount = todos.reduce((sum, todo) => sum + todo.count, 0)
  const done = checklist.filter((item) => item.done).length

  return (
    <>
      {tour && tourStep && (
        <TourOverlay
          title={tourStep.title}
          body={tourStep.body}
          box={tourBox}
          index={tour.index}
          total={tour.steps.length}
          nextRef={nextRef}
          onBack={() =>
            setTour((t) => t && { ...t, index: Math.max(0, t.index - 1) })
          }
          onNext={() =>
            tour.index + 1 >= tour.steps.length
              ? endTour()
              : setTour((t) => t && { ...t, index: t.index + 1 })
          }
          onStop={endTour}
        />
      )}
      {!tourStep && guide && guideHere && (
        <GuideOverlay
          title={guideStep.title}
          body={guideStep.body}
          box={guideBox}
          index={guide.index}
          total={WALKTHROUGH.length}
          nextRef={nextRef}
          onBack={() => goGuide(guide.index - 1)}
          onNext={() => goGuide(guide.index + 1)}
          onStop={() => finishGuide(false)}
        />
      )}
      {!tourStep && !guideHere && shown && (
        <SayingBubble saying={shown} onClose={closeSaying} />
      )}
      <div
        className={cn(
          "fixed right-3 bottom-3 md:right-5 md:bottom-5",
          tourStep ? "z-[70]" : "z-40",
        )}
      >
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger
            disabled={!!tourStep}
            render={
              <Mascot
                directions={SHEETS.directions}
                reactions={SHEETS.reactions}
                size={64}
                mood={mood}
                data-tour="helper"
                aria-label={`Help from ${HELPER_NAME}: tips for this page${todoCount > 0 ? `, ${todoCount} to do today` : ""}`}
                className="size-14 rounded-full bg-card shadow-md ring-1 ring-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:size-16"
                artClassName="absolute -inset-2.5 size-auto"
                style={{ width: undefined, height: undefined }}
              />
            }
          />
          {todoCount > 0 && !tourStep && (
            <span
              aria-hidden
              data-testid="helper-badge"
              className="pointer-events-none absolute -top-1 -left-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rust px-1 text-[0.6875rem] font-semibold text-white tabular-nums ring-2 ring-background"
            >
              {todoCount > 99 ? "99+" : todoCount}
            </span>
          )}
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-[min(24rem,calc(100vw-1.5rem))] gap-3 p-3"
          >
            <div>
              <p className="font-medium">{page.title}</p>
              <p className="text-xs text-muted-foreground">
                {HELPER_NAME} the helper cat
              </p>
            </div>
            <Tabs defaultValue={todoCount > 0 ? "today" : "page"}>
              <TabsList className="w-full">
                <TabsTrigger value="page">This page</TabsTrigger>
                <TabsTrigger value="today">
                  Today{todoCount > 0 ? ` ${todoCount}` : ""}
                </TabsTrigger>
                {checklist.length > 0 && (
                  <TabsTrigger value="start">
                    Getting started {done}/{checklist.length}
                  </TabsTrigger>
                )}
              </TabsList>
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
              <TabsContent value="today">
                <TodoList todos={todos} onNavigate={() => setOpen(false)} />
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
            <div className="flex flex-col gap-1 border-t pt-2">
              {hasPageTour && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={startPageTour}
                >
                  <MapIcon aria-hidden />
                  Tour this page
                </Button>
              )}
              {canAddProducts && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={startGuide}
                >
                  <ShirtIcon aria-hidden />
                  Walk me through adding a product
                </Button>
              )}
              {canAddProducts && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  render={
                    <Link
                      href="/admin/help/add-product"
                      onClick={() => setOpen(false)}
                    />
                  }
                >
                  <BookOpenIcon aria-hidden />
                  How to add a product (guide)
                </Button>
              )}
              <div className="flex flex-wrap justify-between gap-1">
                <Button size="sm" variant="ghost" onClick={startWelcome}>
                  <SparklesIcon aria-hidden />
                  Welcome tour
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
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}

/** Today's to-do list: the same lines as the dashboard card. */
export function TodoList({
  todos,
  onNavigate,
}: {
  todos: TodoItem[]
  onNavigate?: () => void
}) {
  if (todos.length === 0) {
    return (
      <p className="pt-1 text-sm text-muted-foreground">
        All clear. Nothing needs you right now.
      </p>
    )
  }
  return (
    <ul className="flex flex-col pt-1">
      {todos.map((todo) => (
        <li key={todo.key}>
          <Link
            href={todo.href as Route}
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-sm p-1.5 text-sm hover:bg-secondary"
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-rust"
            />
            {todo.label}
          </Link>
        </li>
      ))}
    </ul>
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

import type { Mood } from "./mascot"
import { HELPER_NAME } from "../tips"

export type TourStep = {
  /** Selectors tried in order; the first visible match is highlighted. */
  targets: string[]
  title: string
  body: string
  mood: Mood
}

/** The first-visit tour. Steps whose target isn't on screen are skipped. */
export const TOUR_STEPS: TourStep[] = [
  {
    targets: [],
    title: `Hi, I'm ${HELPER_NAME}!`,
    body: "I'll show you around the admin. It takes less than a minute.",
    mood: "delighted",
  },
  {
    targets: ['[data-tour="nav"]', '[data-tour="nav-mobile"]'],
    title: "The menu",
    body: "Everything you can do lives here. You only see the parts your role allows.",
    mood: "wink",
  },
  {
    targets: ['[data-tour="search"]'],
    title: "Search anything",
    body: "Find an order, product, customer or page. Shortcut: ⌘K, or Ctrl K on Windows.",
    mood: "surprised",
  },
  {
    targets: ['[data-tour="nav"] a[href="/admin/orders"]'],
    title: "Orders",
    body: "New orders arrive here. Open one to pack it and book the courier.",
    mood: "sparkle",
  },
  {
    targets: ['[data-tour="nav"] a[href="/admin/products"]'],
    title: "Products",
    body: "Add products with photos, colours and sizes, then publish them to the shop.",
    mood: "heart",
  },
  {
    targets: ['[data-tour="nav"] a[href="/admin/cms"]'],
    title: "Website pages",
    body: "Edit the home page and other pages. Changes stay as drafts until they're published.",
    mood: "sparkle",
  },
  {
    targets: ['[data-tour="view-store"]'],
    title: "See the shop",
    body: "Opens the website just as customers see it.",
    mood: "wink",
  },
  {
    targets: ['[data-tour="helper"]'],
    title: "I'm always here",
    body: "Click me for tips, today's to-do list and a tour of any page. You can hide me anytime.",
    mood: "heart",
  },
]

function visible(element: Element): boolean {
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}

/** The first visible element matching any selector, in order. */
export function findFirst(selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (visible(element)) return element
    }
  }
  return null
}

export function findTarget(step: TourStep): Element | null {
  return findFirst(step.targets)
}

/** The steps that make sense on this screen for this person. */
export function availableSteps(steps: TourStep[] = TOUR_STEPS): TourStep[] {
  return steps.filter(
    (step) => step.targets.length === 0 || findTarget(step) !== null,
  )
}

import type { Mood } from "./mascot"

/**
 * The product walkthrough: a guide that doesn't block the page. The person
 * works as normal; the helper points at the next thing and moves on by
 * itself once it's done (or on Next).
 */

export const WALKTHROUGH_KEY = "product-walkthrough"

const NEW_PRODUCT = /^\/admin\/products\/new\/?$/
const PRODUCT = /^\/admin\/products\/([0-9a-f-]{36})\/?$/

export type GuideStep = {
  /** "new" for the New product page, "edit" for the product just created. */
  page: "new" | "edit"
  target: string
  title: string
  body: string
  mood: Mood
  /** True once the person has done this step; checked a few times a second. */
  done?: (path: string) => boolean
}

const el = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)

const filledAndLeft =
  (selector: string, min = 1) =>
  () => {
    const input = el<HTMLInputElement>(selector)
    return (
      !!input &&
      input.value.trim().length >= min &&
      document.activeElement !== input
    )
  }

const ticked =
  (selector: string, min = 1) =>
  () =>
    (el(selector)?.querySelectorAll("input[type=checkbox]:checked").length ??
      0) >= min

const selected = (selector: string) => () =>
  el(selector)?.getAttribute("aria-selected") === "true"

const exists = (selector: string) => () => !!el(selector)

export const WALKTHROUGH: GuideStep[] = [
  // ── New product ──────────────────────────────────────────────────────────
  {
    page: "new",
    target: '[data-tour="page-title"]',
    title: "Before you start",
    body: "The category, its size chart and your colours and sizes should exist first. The full guide is under 'How to add a product'.",
    mood: "delighted",
  },
  {
    page: "new",
    target: "#pf-title",
    title: "Name it",
    body: "Type the product's name, like 'Samurai Spirit Graphic Hoodie – Beige'. The web address fills itself in.",
    mood: "sparkle",
    done: filledAndLeft("#pf-title", 3),
  },
  {
    page: "new",
    target: '[data-tour="categories"]',
    title: "Pick its category",
    body: "Tick the most specific one first, like Hoodies. The first one ticked sets the size chart.",
    mood: "wink",
    done: ticked('[data-tour="categories"]'),
  },
  {
    page: "new",
    target: '[data-tour="variant-options"]',
    title: "Colour, then Size",
    body: "Tick Colour first, then Size. Customers choose a colour, then their size. This can't change later.",
    mood: "surprised",
    done: ticked('[data-tour="variant-options"]', 2),
  },
  {
    page: "new",
    target: '[data-tour="description"]',
    title: "Describe it",
    body: "Fabric, fit and what makes it special. Press Next when you're done.",
    mood: "heart",
  },
  {
    page: "new",
    target: "#pf-weightGrams",
    title: "Packed weight",
    body: "The weight in grams once packed. The courier charges by it. Press Next when it's right.",
    mood: "wink",
  },
  {
    page: "new",
    target: '[data-tour="save-product"]',
    title: "Create it",
    body: "Fill in the manufacturer if it's empty, then press Create product. Sizes, stock and photos come next.",
    mood: "sparkle",
    done: (path) => PRODUCT.test(path),
  },
  // ── Sizes, prices and stock first: photos are tagged with these colours ──
  {
    page: "edit",
    target: '[data-tour="tab-variants"]',
    title: "Sizes and colours",
    body: "Saved! Open Variants & stock. Sizes and colours come before photos, so photos can be tagged by colour.",
    mood: "delighted",
    done: selected('[data-tour="tab-variants"]'),
  },
  {
    page: "edit",
    target: '[data-tour="generate-variants"]',
    title: "Generate variants",
    body: "Tick the colours and sizes you sell (missing one? use '+ Add new'), enter price, MRP and starting stock, then press Generate.",
    mood: "surprised",
    done: exists('[data-tour="variant-row"]'),
  },
  {
    page: "edit",
    target: '[data-tour="adjust-stock"]',
    title: "Check the stock",
    body: "Each size starts with the stock you entered. To change one, press Stock on its row. Press Next when it's right.",
    mood: "sparkle",
  },
  // ── Photos ───────────────────────────────────────────────────────────────
  {
    page: "edit",
    target: '[data-tour="tab-media"]',
    title: "Photos next",
    body: "Open the Photos tab.",
    mood: "wink",
    done: selected('[data-tour="tab-media"]'),
  },
  {
    page: "edit",
    target: '[data-tour="media-upload"]',
    title: "Upload photos",
    body: "Choose the photos. The first one is the main photo; use the arrows to change the order.",
    mood: "heart",
    done: exists('[data-tour="media-item"]'),
  },
  {
    page: "edit",
    target: '[data-tour="media-colour"]',
    title: "Tag the colours",
    body: "Pick each photo's colour, so customers see the right one. Leave 'All colours' for photos of every colour. Press Next.",
    mood: "surprised",
  },
  {
    page: "edit",
    target: '[data-tour="media-save"]',
    title: "Save the photos",
    body: "Press Save photos to attach them to the product.",
    mood: "sparkle",
    // The health check stops asking for photos once they're saved.
    done: () => !!el('[data-tour="health"]') && !el('[data-health="photos"]'),
  },
  // ── Check, publish, and after ────────────────────────────────────────────
  {
    page: "edit",
    target: '[data-tour="health"]',
    title: "Ready to sell?",
    body: "I check the product here. Fix anything marked 'Must fix'; suggestions are up to you. Press Next.",
    mood: "surprised",
  },
  {
    page: "edit",
    target: '[data-tour="publish"]',
    title: "Publish",
    body: "Press Publish to put it in the shop.",
    mood: "delighted",
    done: () => !el('[data-tour="publish"]'),
  },
  {
    page: "edit",
    target: '[data-tour="view-in-store"]',
    title: "See it in the shop",
    body: "It's live! View in store opens it as customers see it, in a new tab. Press Next.",
    mood: "heart",
  },
  {
    page: "edit",
    target: '[data-tour="nav"] a[href="/admin/collections"]',
    title: "Put it in a collection",
    body: "Optional: add it to a collection, like New Arrivals, so it shows on the home page. That's in Collections.",
    mood: "wink",
  },
]

/** Which page a path is for the walkthrough, and the product it's about. */
export function walkthroughPage(
  path: string,
): { page: "new" } | { page: "edit"; productId: string } | null {
  if (NEW_PRODUCT.test(path)) return { page: "new" }
  const match = PRODUCT.exec(path)
  return match ? { page: "edit", productId: match[1]! } : null
}

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
  {
    page: "new",
    target: "#pf-title",
    title: "Name it",
    body: "Type the product's name, like 'Samurai Spirit Graphic Hoodie – Beige'. The web address fills itself in.",
    mood: "delighted",
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
    body: "Press Create product. Next we'll add photos, sizes and stock.",
    mood: "sparkle",
    done: (path) => PRODUCT.test(path),
  },
  {
    page: "edit",
    target: '[data-tour="tab-media"]',
    title: "Photos next",
    body: "Saved! Open the Photos tab.",
    mood: "delighted",
    done: selected('[data-tour="tab-media"]'),
  },
  {
    page: "edit",
    target: '[data-tour="media-upload"]',
    title: "Upload photos",
    body: "Choose the photos. With more than one colour, tag each photo with its colour.",
    mood: "heart",
    done: exists('[data-tour="media-item"]'),
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
  {
    page: "edit",
    target: '[data-tour="tab-variants"]',
    title: "Sizes and colours",
    body: "Now open Variants & stock.",
    mood: "wink",
    done: selected('[data-tour="tab-variants"]'),
  },
  {
    page: "edit",
    target: '[data-tour="generate-variants"]',
    title: "Generate variants",
    body: "Tick the colours and sizes you sell, enter the price, MRP and starting stock, then press Generate.",
    mood: "surprised",
    done: exists('[data-tour="variant-row"]'),
  },
  {
    page: "edit",
    target: '[data-tour="adjust-stock"]',
    title: "Check the stock",
    body: "Each size starts with the stock you entered. To change one, press Stock on its row and choose 'Received new stock'. Press Next when it's right.",
    mood: "sparkle",
  },
  {
    page: "edit",
    target: '[data-tour="publish"]',
    title: "Publish",
    body: "Check the 'Ready to sell?' list, then press Publish to put it in the shop.",
    mood: "delighted",
    done: () => !el('[data-tour="publish"]'),
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

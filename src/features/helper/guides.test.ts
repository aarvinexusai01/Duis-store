import { describe, expect, it } from "vitest"

import { ADMIN_NAV } from "@/features/staff"

import { GUIDE_KEY_PATTERN } from "./guide-key"
import { PAGE_TIPS, patternFor } from "./tips"
import { PAGE_TOURS, pageTour } from "./ui/page-tours"
import { WALKTHROUGH, WALKTHROUGH_KEY, walkthroughPage } from "./ui/walkthrough"

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"

describe("page tours", () => {
  it("has a tour for every page in the admin menu, and the product and order editors", () => {
    const hrefs = ADMIN_NAV.flatMap((group) => group.items).map((i) => i.href)
    for (const href of [
      ...hrefs,
      `/admin/products/${ID}`,
      "/admin/orders/DUIS-100001",
    ]) {
      const pattern = patternFor(href)
      expect(pattern && PAGE_TOURS[pattern], href).toBeTruthy()
    }
  })

  it("keeps every tour short and every step readable at a glance", () => {
    for (const [pattern, steps] of Object.entries(PAGE_TOURS)) {
      expect(PAGE_TIPS[pattern], pattern).toBeDefined()
      expect(steps.length, pattern).toBeGreaterThan(0)
      expect(steps.length, pattern).toBeLessThanOrEqual(5)
      for (const step of steps) {
        expect(step.targets.length, step.title).toBeGreaterThan(0)
        expect(step.body.length, step.body).toBeLessThanOrEqual(120)
      }
    }
  })

  it("starts each tour on the page title, and has none for unknown pages", () => {
    const steps = pageTour("/admin/inventory", "Inventory")
    expect(steps[0]).toMatchObject({
      title: "Inventory",
      targets: ['[data-tour="page-title"]'],
    })
    expect(steps.slice(1)).toEqual(PAGE_TOURS["/admin/inventory"])
    expect(pageTour(null, "Admin")).toEqual([])
  })

  it("names every guide with a key the server accepts", () => {
    expect(WALKTHROUGH_KEY).toMatch(GUIDE_KEY_PATTERN)
    for (const pattern of Object.keys(PAGE_TIPS)) {
      expect(`page:${pattern}`).toMatch(GUIDE_KEY_PATTERN)
    }
    expect("page:/shop").not.toMatch(GUIDE_KEY_PATTERN)
    expect("anything").not.toMatch(GUIDE_KEY_PATTERN)
  })
})

describe("product walkthrough", () => {
  it("knows the New product page and a product's own page", () => {
    expect(walkthroughPage("/admin/products/new")).toEqual({ page: "new" })
    expect(walkthroughPage(`/admin/products/${ID}`)).toEqual({
      page: "edit",
      productId: ID,
    })
    expect(walkthroughPage("/admin/products")).toBeNull()
    expect(walkthroughPage("/admin/inventory")).toBeNull()
  })

  it("does the New product page first, ending with the save", () => {
    const pages = WALKTHROUGH.map((step) => step.page)
    const lastNew = pages.lastIndexOf("new")
    expect(pages.slice(0, lastNew + 1).every((p) => p === "new")).toBe(true)
    expect(pages.slice(lastNew + 1).every((p) => p === "edit")).toBe(true)
    expect(WALKTHROUGH[lastNew]!.target).toBe('[data-tour="save-product"]')
    // Saving lands on the product's page, which is how the step is done.
    expect(WALKTHROUGH[lastNew]!.done!(`/admin/products/${ID}`)).toBe(true)
    expect(WALKTHROUGH[lastNew]!.done!("/admin/products/new")).toBe(false)
    for (const step of WALKTHROUGH) {
      expect(step.body.length, step.title).toBeLessThanOrEqual(160)
    }
  })

  it("generates sizes and colours before photos, so photos can be tagged by colour", () => {
    const at = (target: string) =>
      WALKTHROUGH.findIndex((step) => step.target === target)
    expect(at('[data-tour="generate-variants"]')).toBeGreaterThan(-1)
    expect(at('[data-tour="generate-variants"]')).toBeLessThan(
      at('[data-tour="media-upload"]'),
    )
    expect(at('[data-tour="media-colour"]')).toBeLessThan(
      at('[data-tour="media-save"]'),
    )
    expect(at('[data-tour="health"]')).toBeLessThan(at('[data-tour="publish"]'))
    expect(at('[data-tour="publish"]')).toBeLessThan(
      at('[data-tour="view-in-store"]'),
    )
  })
})

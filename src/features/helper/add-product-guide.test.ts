import { describe, expect, it } from "vitest"

import { ADMIN_NAV } from "@/features/staff"

import { ADD_PRODUCT_GUIDE } from "./add-product-guide"

describe("the written 'How to add a product' guide", () => {
  const sections = ADD_PRODUCT_GUIDE.sections

  it("starts with the one-time setup and ends after publishing", () => {
    expect(sections.map((s) => s.id)).toEqual([
      "setup",
      "details",
      "variants",
      "photos",
      "publish",
      "after",
    ])
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length)
  })

  it("gives every section steps, each with a short title and a body", () => {
    for (const section of sections) {
      expect(section.steps.length, section.id).toBeGreaterThan(0)
      for (const step of section.steps) {
        expect(step.title.length, step.title).toBeLessThanOrEqual(40)
        expect(step.body.length, step.title).toBeGreaterThan(20)
      }
    }
  })

  it("links only to admin pages that exist in the menu", () => {
    const menu = new Set(
      ADMIN_NAV.flatMap((group) => group.items).map((item) => item.href),
    )
    menu.add("/admin/products/new")
    for (const step of sections.flatMap((s) => s.steps)) {
      if (step.where) expect(menu.has(step.where.href), step.title).toBe(true)
    }
  })
})

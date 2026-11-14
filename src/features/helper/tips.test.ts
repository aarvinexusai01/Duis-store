import { describe, expect, it } from "vitest"

import { ADMIN_NAV } from "@/features/staff"

import { PAGE_TIPS, tipsFor } from "./tips"

describe("helper tips", () => {
  it("has its own tips for every page in the admin menu", () => {
    for (const item of ADMIN_NAV.flatMap((group) => group.items)) {
      expect(PAGE_TIPS[item.href], item.href).toBeDefined()
      expect(tipsFor(item.href), item.href).toBe(PAGE_TIPS[item.href])
    }
  })

  it("keeps every tip short enough to read at a glance", () => {
    for (const [pattern, page] of Object.entries(PAGE_TIPS)) {
      expect(page.tips.length, pattern).toBeGreaterThan(0)
      expect(page.tips.length, pattern).toBeLessThanOrEqual(4)
      for (const tip of page.tips) {
        expect(tip.length, tip).toBeLessThanOrEqual(120)
      }
    }
  })

  it("prefers a fixed path over an id", () => {
    expect(tipsFor("/admin/products/new").title).toBe("New product")
    expect(tipsFor("/admin/discounts/new").title).toBe("New discount")
    expect(tipsFor("/admin/orders/cod").title).toBe("COD remittances")
    expect(tipsFor("/admin/cms/journal/settings").title).toBe(
      "Authors, categories and tags",
    )
  })

  it("matches detail pages by id", () => {
    expect(
      tipsFor("/admin/products/0199c1a2-0000-7000-8000-000000000000").title,
    ).toBe("Editing a product")
    expect(tipsFor("/admin/orders/DU-10042").title).toBe("An order")
    expect(tipsFor("/admin/cms/navigation/header").title).toBe("Editing a menu")
  })

  it("ignores query strings and falls back to the nearest section", () => {
    expect(tipsFor("/admin/orders?view=to_ship").title).toBe("Orders")
    expect(tipsFor("/admin/inventory/movements?page=2").title).toBe(
      "Stock movements",
    )
    expect(tipsFor("/admin/products/123/unknown").title).toBe(
      "Editing a product",
    )
    expect(tipsFor("/admin/something-new").title).toBe("Admin")
    expect(tipsFor("/admin").title).toBe("Dashboard")
  })
})

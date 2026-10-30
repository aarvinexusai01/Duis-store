import { describe, expect, it } from "vitest"

import { canonicalPagePath, pageHref } from "./page-href"

describe("CMS page addresses", () => {
  it("gives each page one address", () => {
    expect(pageHref("faq")).toBe("/faq")
    expect(pageHref("shipping-policy")).toBe("/policies/shipping-policy")
    expect(pageHref("lookbook")).toBe("/pages/lookbook")
  })

  it("redirects every other way of reaching a page", () => {
    expect(canonicalPagePath("/pages/shipping-policy")).toBe(
      "/policies/shipping-policy",
    )
    expect(canonicalPagePath("/pages/faq")).toBe("/faq")
    expect(canonicalPagePath("/policies/lookbook")).toBe("/pages/lookbook")
    expect(canonicalPagePath("/policies/shipping-policy")).toBeNull()
    expect(canonicalPagePath("/pages/lookbook")).toBeNull()
    expect(canonicalPagePath("/products/tee")).toBeNull()
  })
})

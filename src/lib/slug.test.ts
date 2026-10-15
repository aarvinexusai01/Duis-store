import { describe, expect, it } from "vitest"

import { SLUG, slugify } from "./slug"

describe("slugify", () => {
  it("produces URL-safe slugs", () => {
    expect(slugify("Oversized T-Shirts")).toBe("oversized-t-shirts")
    expect(slugify("  Shirts & Hoodies!  ")).toBe("shirts-and-hoodies")
    expect(slugify("Café Crème")).toBe("cafe-creme")
  })

  it("always matches the slug pattern", () => {
    for (const input of ["A", "a--b", "--x--", "Ünïcødé tee", "100% cotton"]) {
      const slug = slugify(input)
      expect(slug === "" || SLUG.test(slug)).toBe(true)
    }
  })
})

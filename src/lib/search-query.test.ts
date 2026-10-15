import { describe, expect, it } from "vitest"

import { normaliseSearchQuery } from "./search-query"

describe("normaliseSearchQuery", () => {
  it("trims, collapses spaces and lower-cases", () => {
    expect(normaliseSearchQuery("  Black   OVERSIZED tee ")).toBe(
      "black oversized tee",
    )
  })

  it("caps the length and handles missing input", () => {
    expect(normaliseSearchQuery("x".repeat(100))).toHaveLength(64)
    expect(normaliseSearchQuery(null)).toBe("")
  })
})

import { describe, expect, it } from "vitest"

import { fromPathSchema, normalizePath, toPathSchema } from "./paths"

describe("redirect paths", () => {
  it("normalise case, trailing slashes and query strings", () => {
    expect(normalizePath("/Sale/")).toBe("/sale")
    expect(normalizePath("/sale?utm=x")).toBe("/sale")
    expect(normalizePath("/")).toBe("/")
  })

  it("refuse the home page and the app's own areas", () => {
    expect(fromPathSchema.safeParse("/").success).toBe(false)
    expect(fromPathSchema.safeParse("/admin/orders").success).toBe(false)
    expect(fromPathSchema.safeParse("/api/x").success).toBe(false)
    expect(fromPathSchema.safeParse("/old?x=1").success).toBe(false)
    expect(fromPathSchema.parse("/Old-Sale/")).toBe("/old-sale")
  })

  it("only send visitors to site paths or https links", () => {
    expect(toPathSchema.safeParse("/collections/summer").success).toBe(true)
    expect(toPathSchema.safeParse("https://example.com/x").success).toBe(true)
    expect(toPathSchema.safeParse("//evil.example").success).toBe(false)
    expect(toPathSchema.safeParse("javascript:alert(1)").success).toBe(false)
    expect(toPathSchema.safeParse("http://insecure.example").success).toBe(
      false,
    )
  })
})

import { describe, expect, it } from "vitest"

import { completeSignInUrl, safeNextPath } from "./safe-redirect"

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/products/tee?color=black")).toBe(
      "/products/tee?color=black",
    )
  })

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/api/auth/sign-out",
    "/auth/complete?next=/x",
    "/ok\nSet-Cookie:x",
    "",
  ])("rejects %j", (next) => {
    expect(safeNextPath(next)).toBe("/account")
  })

  it("builds the completion URL", () => {
    expect(completeSignInUrl("/cart")).toBe("/auth/complete?next=%2Fcart")
  })
})

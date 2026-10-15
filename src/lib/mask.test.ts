import { describe, expect, it } from "vitest"

import { maskEmail, maskPhone } from "./mask"

describe("maskEmail", () => {
  it("keeps the first and last character of the local part", () => {
    expect(maskEmail("shivansh@gmail.com")).toBe("s******h@gmail.com")
  })

  it("handles very short or malformed addresses", () => {
    expect(maskEmail("ab@x.in")).toBe("a*@x.in")
    expect(maskEmail("not-an-email")).toBe("***")
  })
})

describe("maskPhone", () => {
  it("keeps the country code and the last four digits", () => {
    expect(maskPhone("+919876543210")).toBe("+91******3210")
  })

  it("masks numbers without a country code", () => {
    expect(maskPhone("9876543210")).toBe("******3210")
    expect(maskPhone("123")).toBe("***")
  })
})

import { describe, expect, it } from "vitest"

import { fitDescription, fitTitle, rupees, storePromises } from "./seo"

describe("fitTitle", () => {
  it("picks the richest title that fits in 60 characters with the brand", () => {
    expect(
      fitTitle(
        "Polo T-Shirts for Men — Buy Online in India",
        "Polo T-Shirts for Men",
        "Polo T-Shirts",
      ),
    ).toBe("Polo T-Shirts for Men — Buy Online in India")
    expect(
      fitTitle(
        "Heavyweight Oversized Graphic Tee for Men — Buy Online in India",
        "Heavyweight Oversized Graphic Tee for Men",
        "Heavyweight Oversized Graphic Tee",
      ),
    ).toBe("Heavyweight Oversized Graphic Tee for Men")
  })
})

describe("fitDescription", () => {
  it("cuts at a word with an ellipsis, never mid-word", () => {
    const text = "word ".repeat(60)
    const cut = fitDescription(text)
    expect(cut.length).toBeLessThanOrEqual(155)
    expect(cut.endsWith("word…")).toBe(true)
  })
  it("leaves short text alone", () => {
    expect(fitDescription("  Soft   cotton. ")).toBe("Soft cotton.")
  })
})

describe("storePromises", () => {
  it("lists the store's promises from its settings", () => {
    expect(
      storePromises({
        freeShippingThresholdPaise: 99_900,
        exchangeWindowDays: 10,
        partialCodEnabled: true,
      }),
    ).toBe(
      "Free shipping above ₹999, cash on delivery and easy 10-day exchanges.",
    )
    expect(
      storePromises({
        freeShippingThresholdPaise: 150_000,
        exchangeWindowDays: 7,
        partialCodEnabled: false,
      }),
    ).toBe("Free shipping above ₹1,500 and easy 7-day exchanges.")
    expect(rupees(129_900)).toBe("₹1,299")
  })
})

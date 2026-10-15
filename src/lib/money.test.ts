import { describe, expect, it } from "vitest"

import { discountPercent, formatPaise } from "./money"

describe("formatPaise", () => {
  it("formats rupees with Indian digit grouping", () => {
    expect(formatPaise(79_900)).toBe("₹799")
    expect(formatPaise(12_345_600)).toBe("₹1,23,456")
    expect(formatPaise(123_450)).toBe("₹1,234.50")
  })

  it("refuses fractional paise", () => {
    expect(() => formatPaise(10.5)).toThrow()
  })
})

describe("discountPercent", () => {
  it("rounds down so a discount is never overstated", () => {
    expect(discountPercent(79_900, 99_900)).toBe(20)
    expect(discountPercent(66_600, 99_900)).toBe(33)
  })

  it("is zero without a real discount", () => {
    expect(discountPercent(99_900, 99_900)).toBe(0)
    expect(discountPercent(100, 0)).toBe(0)
  })
})

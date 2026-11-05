import { describe, expect, it } from "vitest"

import {
  formatMoney,
  formatRate,
  paiseToUsdCents,
  paiseToUsdCentsPlain,
  parseEcbUsdInr,
  parseFrankfurterUsdInr,
  parseRate,
  rateProblem,
  usdCentsToPaise,
} from "./fx"

const at = (rupees: number, upliftBp = 0) => ({
  rateMicros: Math.round(rupees * 1_000_000),
  upliftBp,
})

describe("paiseToUsdCents", () => {
  it("converts, adds the country's increase and rounds up to .99", () => {
    // ₹2,499 at ₹84.50 = $29.57, +15% = $34.0059 → $34.99
    expect(paiseToUsdCents(249_900, at(84.5, 1500))).toBe(3499)
    // ₹999 at ₹84.50 = $11.8225 → $11.99
    expect(paiseToUsdCents(99_900, at(84.5))).toBe(1199)
  })

  it("leaves a price already ending in .99 alone and never rounds down", () => {
    expect(paiseToUsdCents(129_900, at(100))).toBe(1299)
    expect(paiseToUsdCents(130_000, at(100))).toBe(1399)
    // A hair over a dollar boundary goes to the next .99.
    expect(paiseToUsdCents(130_001, at(100))).toBe(1399)
  })

  it("keeps zero at zero and handles big orders without overflow", () => {
    expect(paiseToUsdCents(0, at(84.5, 5000))).toBe(0)
    expect(paiseToUsdCents(100_000_000, at(50, 10_000))).toBe(4_000_099)
  })

  it("always ends in .99, never below the exact price and under a dollar above it", () => {
    let previous = 0
    for (let paise = 1; paise < 400_000; paise += 997) {
      const pricing = at(84.5, 1500)
      const cents = paiseToUsdCents(paise, pricing)
      const exact = paiseToUsdCentsPlain(paise, pricing, "ceil")
      expect(cents % 100).toBe(99)
      expect(cents).toBeGreaterThanOrEqual(exact)
      expect(cents - exact).toBeLessThan(100)
      expect(cents).toBeGreaterThanOrEqual(previous)
      previous = cents
    }
  })

  it("refuses fractions, a zero rate and negative increases", () => {
    expect(() => paiseToUsdCents(1.5, at(84.5))).toThrow()
    expect(() => paiseToUsdCents(100, { rateMicros: 0, upliftBp: 0 })).toThrow()
    expect(() => paiseToUsdCents(100, at(84.5, -1))).toThrow()
  })
})

describe("paiseToUsdCentsPlain", () => {
  it("rounds minimums up and caps down, without .99", () => {
    // ₹500 at ₹84.50 = 591.7 cents
    expect(paiseToUsdCentsPlain(50_000, at(84.5), "ceil")).toBe(592)
    expect(paiseToUsdCentsPlain(50_000, at(84.5), "floor")).toBe(591)
  })
})

describe("usdCentsToPaise", () => {
  it("gives the rupee equivalent, rounding half up", () => {
    expect(usdCentsToPaise(3499, at(84.5).rateMicros)).toBe(295_666)
    expect(usdCentsToPaise(1, 84_500_000)).toBe(85)
    expect(usdCentsToPaise(0, 84_500_000)).toBe(0)
  })
})

describe("formatting and parsing", () => {
  it("formats each currency its own way", () => {
    expect(formatMoney(3499, "USD")).toBe("$34.99")
    expect(formatMoney(100_000, "USD")).toBe("$1,000.00")
    expect(formatMoney(249_900, "INR")).toBe("₹2,499")
  })

  it("shows and reads rates in rupees per dollar", () => {
    expect(formatRate(84_500_000)).toBe("₹84.5000")
    expect(parseRate("84.5")).toBe(84_500_000)
    expect(parseRate(" 83.123456 ")).toBe(83_123_456)
    expect(parseRate("84,50")).toBeNull()
    expect(parseRate("")).toBeNull()
  })
})

describe("rate sources", () => {
  const ecb = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope><Cube><Cube time='2026-11-04'>
<Cube currency='USD' rate='1.0800'/><Cube currency='JPY' rate='163.10'/>
<Cube currency='INR' rate='91.2600'/></Cube></Cube></gesmes:Envelope>`

  it("reads rupees per dollar from the ECB's euro rates", () => {
    // 91.26 / 1.08 = 84.5
    expect(parseEcbUsdInr(ecb)).toEqual({
      rateMicros: 84_500_000,
      asOf: "2026-11-04",
    })
    expect(parseEcbUsdInr("<html>maintenance</html>")).toBeNull()
  })

  it("reads Frankfurter's dollar-based answer", () => {
    expect(
      parseFrankfurterUsdInr({
        amount: 1,
        base: "USD",
        date: "2026-11-04",
        rates: { INR: 84.5 },
      }),
    ).toEqual({ rateMicros: 84_500_000, asOf: "2026-11-04" })
    expect(parseFrankfurterUsdInr({ base: "EUR", rates: {} })).toBeNull()
  })

  it("distrusts implausible rates and big daily jumps", () => {
    expect(rateProblem(84_500_000, null)).toBeNull()
    expect(rateProblem(845_000, null)).toMatch(/plausible/)
    expect(rateProblem(84_500_000, 84_000_000)).toBeNull()
    expect(rateProblem(90_000_000, 84_000_000)).toMatch(/5%/)
  })
})

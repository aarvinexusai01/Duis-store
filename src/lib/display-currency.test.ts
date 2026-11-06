import { describe, expect, it } from "vitest"

import {
  isCrawler,
  parseDisplayCurrency,
  usdCentsToListPaise,
  visitorCountry,
  visitorPricing,
} from "./display-currency"
import { paiseToUsdCents } from "./fx"

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

const pricing = {
  rateMicros: 84_500_000,
  defaultUpliftBp: 1000,
  countryUpliftBp: { US: 1500, GB: 2000 },
}

describe("isCrawler", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "AdsBot-Google (+http://www.google.com/adsbot.html)",
    "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0",
    "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0 Safari/537.36 Chrome-Lighthouse",
    "",
  ])("treats %s as a crawler", (agent) => {
    expect(isCrawler(agent)).toBe(true)
  })

  it("lets browsers through", () => {
    expect(isCrawler(CHROME)).toBe(false)
    expect(
      isCrawler(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false)
    expect(isCrawler(null)).toBe(true)
  })
})

describe("visitorCountry", () => {
  it("accepts Cloudflare's two-letter codes", () => {
    expect(visitorCountry("US")).toBe("US")
    expect(visitorCountry(" gb ")).toBe("GB")
  })
  it("treats unknown, Tor and junk as no country", () => {
    expect(visitorCountry("XX")).toBeNull()
    expect(visitorCountry("T1")).toBeNull()
    expect(visitorCountry("USA")).toBeNull()
    expect(visitorCountry(null)).toBeNull()
  })
})

describe("visitorPricing", () => {
  const browser = (country: string | null) => ({ country, crawler: false })

  it("suggests dollars outside India, with the country's own increase", () => {
    expect(visitorPricing(pricing, browser("US"))).toEqual({
      usd: { rateMicros: 84_500_000, upliftBp: 1500 },
      suggested: "USD",
      country: "US",
    })
    expect(visitorPricing(pricing, browser("DE")).usd?.upliftBp).toBe(1000)
  })

  it("suggests rupees in India and when the country is unknown", () => {
    expect(visitorPricing(pricing, browser("IN"))).toMatchObject({
      suggested: "INR",
      usd: { upliftBp: 1000 },
    })
    expect(visitorPricing(pricing, browser(null)).suggested).toBe("INR")
  })

  it("is rupees only for crawlers and while switched off", () => {
    expect(visitorPricing(pricing, { country: "US", crawler: true })).toEqual({
      usd: null,
      suggested: "INR",
      country: "US",
    })
    expect(visitorPricing(null, browser("US"))).toEqual({
      usd: null,
      suggested: "INR",
      country: "US",
    })
  })
})

describe("parseDisplayCurrency", () => {
  it("reads only the two currencies", () => {
    expect(parseDisplayCurrency("USD")).toBe("USD")
    expect(parseDisplayCurrency("INR")).toBe("INR")
    expect(parseDisplayCurrency("usd")).toBeNull()
    expect(parseDisplayCurrency(null)).toBeNull()
  })
})

describe("usdCentsToListPaise", () => {
  const terms = { rateMicros: 84_500_000, upliftBp: 1500 }

  it("inverts the conversion before rounding", () => {
    // $34.99 shown for ₹2,499; $35 maps back to just above ₹2,499.
    expect(paiseToUsdCents(249_900, terms)).toBe(3499)
    const paise = usdCentsToListPaise(3500, terms)
    expect(paise).toBeGreaterThan(249_900)
    expect(paise).toBeLessThan(260_000)
  })

  it("keeps a price under a dollar limit when its shown price is under it", () => {
    for (const paise of [49_900, 99_900, 149_900, 249_900, 999_900]) {
      const shown = paiseToUsdCents(paise, terms)
      expect(usdCentsToListPaise(shown + 1, terms)).toBeGreaterThanOrEqual(
        paise,
      )
    }
  })
})

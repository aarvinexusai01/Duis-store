import { describe, expect, it } from "vitest"

import {
  EMPTY_PARAMS,
  hasFilters,
  parseListingParams,
  serializeListingParams,
  toggleFacet,
} from "./listing-params"

describe("listing URL parameters", () => {
  it("parses filters, price, sort and page", () => {
    const params = parseListingParams({
      color: "blue,black",
      size: ["m", "l"],
      price: "500-999",
      available: "1",
      sort: "price_asc",
      page: "3",
    })
    expect(params).toMatchObject({
      color: ["black", "blue"],
      size: ["l", "m"],
      priceMinPaise: 50_000,
      priceMaxPaise: 99_900,
      available: true,
      sort: "price_asc",
      page: 3,
    })
  })

  it("drops anything malformed instead of failing", () => {
    const params = parseListingParams({
      color: "<script>,blue",
      price: "999-500",
      sort: "drop table",
      page: "-4",
    })
    expect(params).toMatchObject({
      color: ["blue"],
      priceMinPaise: null,
      sort: "featured",
      page: 1,
    })
  })

  it("serialises canonically, so equal filters give equal URLs", () => {
    const a = serializeListingParams(
      parseListingParams({ color: "blue,black", size: "m" }),
    )
    const b = serializeListingParams(
      parseListingParams({ size: "m", color: "black,blue" }),
    )
    expect(a).toBe("?color=black,blue&size=m")
    expect(a).toBe(b)
    expect(serializeListingParams(EMPTY_PARAMS)).toBe("")
  })

  it("round-trips", () => {
    const params = parseListingParams({
      fit: "oversized",
      price: "-999",
      sort: "newest",
      page: "2",
    })
    const query = new URLSearchParams(serializeListingParams(params).slice(1))
    expect(parseListingParams(Object.fromEntries(query))).toEqual(params)
  })

  it("toggles a facet and resets the page", () => {
    const params = { ...EMPTY_PARAMS, page: 4 }
    const on = toggleFacet(params, "color", "black")
    expect(on).toMatchObject({ color: ["black"], page: 1 })
    expect(toggleFacet(on, "color", "black").color).toEqual([])
    expect(hasFilters(on)).toBe(true)
    expect(hasFilters(EMPTY_PARAMS)).toBe(false)
  })
})

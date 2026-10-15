import { describe, expect, it } from "vitest"

import { findVariant, initialSelection, optionState } from "./variant-selection"

const axes = [
  { code: "color", values: [{ slug: "black" }, { slug: "white" }] },
  { code: "size", values: [{ slug: "s" }, { slug: "m" }] },
]
const variants = [
  { id: "bs", options: { color: "black", size: "s" } },
  { id: "bm", options: { color: "black", size: "m" } },
  { id: "ws", options: { color: "white", size: "s" } },
]

describe("variant selection", () => {
  it("finds the variant only for a complete, existing selection", () => {
    expect(findVariant(axes, variants, { color: "black", size: "m" })?.id).toBe(
      "bm",
    )
    expect(findVariant(axes, variants, { color: "black" })).toBeUndefined()
    expect(
      findVariant(axes, variants, { color: "white", size: "m" }),
    ).toBeUndefined()
  })

  it("marks missing combinations and sold-out sizes", () => {
    const stock = { bs: 0, bm: 3, ws: 1 }
    expect(optionState(variants, { color: "white" }, stock, "size", "m")).toBe(
      "missing",
    )
    expect(optionState(variants, { color: "black" }, stock, "size", "s")).toBe(
      "sold_out",
    )
    expect(optionState(variants, { color: "black" }, stock, "size", "m")).toBe(
      "available",
    )
    expect(optionState(variants, { color: "black" }, null, "size", "s")).toBe(
      "available",
    )
  })

  it("starts from valid URL values and never from an impossible pair", () => {
    expect(
      initialSelection(axes, variants, { color: "white", size: "s" }),
    ).toEqual({
      color: "white",
      size: "s",
    })
    expect(
      initialSelection(axes, variants, { color: "white", size: "m" }),
    ).toEqual({
      color: "white",
      size: undefined,
    })
    expect(initialSelection(axes, variants, { color: "purple" })).toEqual({
      color: "black",
    })
  })
})

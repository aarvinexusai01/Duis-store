import { describe, expect, it } from "vitest"

import { productHealth } from "./health"

const colours = [
  { id: "c-black", slug: "black", label: "Black", swatchHex: null },
  { id: "c-navy", slug: "navy", label: "Navy", swatchHex: null },
]
const options = {
  attributes: [
    {
      id: "a-color",
      code: "color",
      name: "Colour",
      kind: "swatch",
      isVariantAxis: true,
      isFilterable: true,
      values: colours,
    },
  ],
  categories: [
    { id: "tees", parentId: null, name: "T-Shirts", sizeChartId: "chart" },
    { id: "graphic", parentId: "tees", name: "Graphic", sizeChartId: null },
    { id: "hoodies", parentId: null, name: "Hoodies", sizeChartId: null },
  ],
} as unknown as Parameters<typeof productHealth>[1]

const variant = (color: string, size: string, onHand = 5) => ({
  id: `${color}-${size}`,
  sku: `${color}-${size}`,
  label: `${color} / ${size}`,
  options: { color, size },
  pricePaise: 99_900,
  mrpPaise: 129_900,
  status: "active" as const,
  onHand,
  reserved: 0,
})

const description = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Soft." }] }],
} as never

const ready = {
  description,
  categoryIds: ["graphic"],
  variants: [variant("black", "m"), variant("navy", "m")],
  media: [{ colorValueId: "c-black" }, { colorValueId: "c-navy" }] as never,
}

const keys = (product: Parameters<typeof productHealth>[0]) =>
  productHealth(product, options).map((item) => item.key)

describe("productHealth", () => {
  it("is happy with a complete product, using a parent's size chart", () => {
    expect(productHealth(ready, options)).toEqual([])
  })

  it("lists the publish blockers for a new product", () => {
    const items = productHealth(
      { description: null, categoryIds: ["graphic"], variants: [], media: [] },
      options,
    )
    expect(
      items.filter((i) => i.level === "blocker").map((i) => i.key),
    ).toEqual(["photos", "variants"])
  })

  it("warns about stock: none at all, or some sizes sold out", () => {
    expect(
      keys({
        ...ready,
        variants: [variant("black", "m", 0), variant("navy", "m", 0)],
      }),
    ).toEqual(["stock"])
    const [item] = productHealth(
      { ...ready, variants: [variant("black", "m"), variant("navy", "l", 0)] },
      options,
    )
    expect(item).toMatchObject({ key: "sold-out", level: "warning" })
    expect(item!.message).toBe("1 size is sold out: navy / l.")
  })

  it("ignores inactive sizes", () => {
    expect(
      keys({
        ...ready,
        variants: [
          ...ready.variants,
          { ...variant("black", "xl", 0), status: "inactive" },
        ],
      }),
    ).toEqual([])
  })

  it("names colours without their own photo, only when there are two or more", () => {
    const items = productHealth(
      { ...ready, media: [{ colorValueId: null }] as never },
      options,
    )
    expect(items.map((i) => i.message)).toContain(
      "Black and Navy have no photo of their own, so customers see another colour.",
    )
    expect(
      keys({
        ...ready,
        variants: [variant("black", "m")],
        media: [{ colorValueId: null }] as never,
      }),
    ).toEqual([])
  })

  it("asks for a description and a size chart", () => {
    const items = productHealth(
      { ...ready, description: null, categoryIds: ["hoodies"] },
      options,
    )
    expect(items.map((i) => i.key)).toEqual(["description", "size-chart"])
    expect(items[1]).toMatchObject({
      message: "Hoodies has no size chart, so customers can't check the fit.",
      fix: { href: "/admin/categories" },
    })
  })
})

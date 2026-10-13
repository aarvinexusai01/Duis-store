import { describe, expect, it } from "vitest"

import imageLoader, { MEDIA_WIDTHS, nearestMediaWidth } from "./image-loader"

describe("nearestMediaWidth", () => {
  it("picks the smallest stored width that covers the request", () => {
    expect(nearestMediaWidth(1)).toBe(320)
    expect(nearestMediaWidth(320)).toBe(320)
    expect(nearestMediaWidth(321)).toBe(640)
    expect(nearestMediaWidth(1100)).toBe(1280)
  })

  it("caps at the largest stored width", () => {
    expect(nearestMediaWidth(3840)).toBe(MEDIA_WIDTHS.at(-1))
  })
})

describe("imageLoader", () => {
  it("maps media originals to a pre-generated rendition", () => {
    expect(imageLoader({ src: "/media/ab12cd/original.jpg", width: 750 })).toBe(
      "/media/ab12cd/960.webp",
    )
  })

  it("accepts a bare media key", () => {
    expect(imageLoader({ src: "/media/ab12cd", width: 200 })).toBe(
      "/media/ab12cd/320.webp",
    )
  })

  it("passes other sources through with a width hint", () => {
    expect(imageLoader({ src: "/icons/logo.png", width: 64 })).toBe(
      "/icons/logo.png?w=64",
    )
    expect(
      imageLoader({ src: "https://cdn.example.com/a.png?v=2", width: 64 }),
    ).toBe("https://cdn.example.com/a.png?v=2&w=64")
  })
})

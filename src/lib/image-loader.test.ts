import { afterAll, beforeAll, describe, expect, it } from "vitest"

import imageLoader, {
  MEDIA_WIDTHS,
  mediaSrc,
  nearestMediaWidth,
} from "./image-loader"

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

describe("ImageKit keys (Phase 10)", () => {
  const hex = "0123456789abcdef0123456789abcdef"
  beforeAll(() => {
    process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT =
      "https://ik.imagekit.io/DUIS/"
  })
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
  })

  it("serves product photos clean no wider than 960", () => {
    expect(mediaSrc(`ikp-${hex}`, 640)).toBe(
      `https://ik.imagekit.io/DUIS/duis/${hex}/clean.webp?tr=w-640`,
    )
    expect(mediaSrc(`ikp-${hex}`, 1920)).toBe(
      `https://ik.imagekit.io/DUIS/duis/${hex}/clean.webp?tr=w-960`,
    )
  })

  it("serves the watermarked copy for zoom, up to 1920", () => {
    expect(mediaSrc(`ikp-${hex}`, 3000, "zoom")).toBe(
      `https://ik.imagekit.io/DUIS/duis/${hex}/zoom.webp?tr=w-1920`,
    )
    expect(imageLoader({ src: `/media/ikp-${hex}?zoom`, width: 1280 })).toBe(
      `https://ik.imagekit.io/DUIS/duis/${hex}/zoom.webp?tr=w-1280`,
    )
  })

  it("serves content images clean at full size, and never a zoom copy", () => {
    expect(mediaSrc(`ikc-${hex}`, 1920)).toBe(
      `https://ik.imagekit.io/DUIS/duis/${hex}/clean.webp?tr=w-1920`,
    )
    expect(mediaSrc(`ikc-${hex}`, 1280, "zoom")).toBe(
      `https://ik.imagekit.io/DUIS/duis/${hex}/clean.webp?tr=w-1280`,
    )
  })

  it("keeps local keys on the media volume", () => {
    expect(mediaSrc(hex, 700)).toBe(`/media/${hex}/960.webp`)
    expect(imageLoader({ src: `/media/${hex}?zoom`, width: 1280 })).toBe(
      `/media/${hex}/1280.webp`,
    )
  })
})

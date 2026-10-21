import { describe, expect, it } from "vitest"

import { paragraphs } from "@/lib/rich-text"

import { instagramUrl, readingMinutes, youtubeId } from "./journal-schemas"

describe("journal embeds", () => {
  it("finds the video in any YouTube link", () => {
    const id = "dQw4w9WgXcQ"
    for (const link of [
      id,
      `https://www.youtube.com/watch?v=${id}&t=10`,
      `https://youtu.be/${id}?si=abc`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
    ])
      expect(youtubeId(link)).toBe(id)
    expect(youtubeId("https://vimeo.com/123")).toBeNull()
    expect(youtubeId("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull()
  })

  it("accepts only Instagram post and reel links", () => {
    expect(instagramUrl("https://instagram.com/p/Cabc123xyz/?igsh=1")).toBe(
      "https://www.instagram.com/p/Cabc123xyz/",
    )
    expect(instagramUrl("https://www.instagram.com/reel/Cabc123xyz")).toBe(
      "https://www.instagram.com/reel/Cabc123xyz/",
    )
    expect(instagramUrl("https://www.instagram.com/duis.store/")).toBeNull()
    expect(instagramUrl("https://evil.example/p/Cabc123xyz/")).toBeNull()
  })

  it("estimates reading time from the text blocks", () => {
    const words = (n: number) =>
      Array.from({ length: n }, () => "word").join(" ")
    expect(readingMinutes({ body: [] })).toBe(1)
    expect(
      readingMinutes({
        body: [
          { id: "a", type: "text", content: paragraphs(words(600)) },
          { id: "b", type: "youtube", videoId: "dQw4w9WgXcQ" },
        ],
      }),
    ).toBe(3)
  })
})

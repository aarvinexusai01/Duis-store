import { describe, expect, it } from "vitest"

import { describeDiff, diffPages } from "./revision-diff"
import type { PageData } from "./schemas"

const text = (id: string, words: string) =>
  ({
    id,
    enabled: true,
    type: "announcement",
    text: words,
  }) as PageData["sections"][number]

const page = (...sections: PageData["sections"]): PageData => ({
  sections,
  seo: {},
})

describe("revision diff", () => {
  it("counts added, removed, edited and moved sections", () => {
    const before = page(text("a", "one"), text("b", "two"), text("c", "three"))
    const after = page(text("c", "three"), text("a", "ONE"), text("d", "new"))
    const diff = diffPages(before, after)
    expect(diff).toEqual({
      added: 1,
      removed: 1,
      edited: 1,
      moved: 2,
      seo: false,
    })
    expect(describeDiff(diff, false)).toBe(
      "Sections: 1 added, 1 removed, 1 edited, 2 moved",
    )
  })

  it("reports SEO-only changes and no changes", () => {
    const before = page(text("a", "one"))
    const after = { ...page(text("a", "one")), seo: { title: "New" } }
    expect(describeDiff(diffPages(before, after), false)).toBe("SEO changed")
    expect(describeDiff(diffPages(before, before), false)).toBe("No changes")
    expect(describeDiff(diffPages(null, before), true)).toBe("First version")
  })
})

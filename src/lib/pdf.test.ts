import { describe, expect, it } from "vitest"

import { textPdf } from "./pdf"

describe("textPdf", () => {
  const pdf = textPdf([
    { text: "AWB FK0000000001", size: 18, bold: true },
    { text: "Ship to: Asha (Rao) \\ Lucknow" },
    { text: "COD ₹1,250 — collect" },
  ])
  const text = pdf.toString("latin1")

  it("is a PDF with a valid cross-reference table", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true)
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true)
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(startxref, startxref + 4)).toBe("xref")
    // Every object offset points at "<n> 0 obj".
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    )
    expect(offsets).toHaveLength(6)
    offsets.forEach((offset, i) =>
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true),
    )
  })

  it("escapes PDF string syntax and replaces characters Helvetica lacks", () => {
    expect(text).toContain("(Ship to: Asha \\(Rao\\) \\\\ Lucknow) Tj")
    expect(text).toContain("(COD Rs.1,250 ? collect) Tj")
  })
})

import { describe, expect, it } from "vitest"

import {
  csvCell,
  csvRecords,
  parseCsv,
  parseIndianDate,
  rupeesToPaise,
} from "./csv"

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF and blank lines", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n\r\n1,2,3\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ])
  })

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"line 1\nline 2",x')).toEqual([["line 1\nline 2", "x"]])
  })
})

describe("csvRecords", () => {
  it("keys rows by a normalised header", () => {
    expect(csvRecords('﻿AWB No.,COD Amount\n123,"1,250"')).toEqual([
      { awb_no: "123", cod_amount: "1,250" },
    ])
  })
})

describe("csvCell", () => {
  it("quotes when needed and defuses formulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"')
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)")
    expect(csvCell(null)).toBe("")
  })
})

describe("rupeesToPaise", () => {
  it("reads common rupee formats", () => {
    expect(rupeesToPaise("₹1,250.50")).toBe(125050)
    expect(rupeesToPaise("Rs. 99")).toBe(9900)
    expect(rupeesToPaise("12.345")).toBeNull()
    expect(rupeesToPaise("abc")).toBeNull()
  })
})

describe("parseIndianDate", () => {
  it("reads ISO and day-first dates as IST", () => {
    expect(parseIndianDate("2026-10-16")?.toISOString()).toBe(
      "2026-10-15T18:30:00.000Z",
    )
    expect(parseIndianDate("16/10/2026")?.toISOString()).toBe(
      "2026-10-15T18:30:00.000Z",
    )
    expect(parseIndianDate("10/16/2026")).toBeNull()
  })
})

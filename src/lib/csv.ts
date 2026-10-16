/**
 * CSV in (RFC 4180: quoted fields, doubled quotes, CRLF or LF) and out.
 * Small on purpose: imports are courier remittance sheets, a few thousand
 * rows at most.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  const input = text.replace(/^﻿/, "")
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"' && field === "") {
      quoted = true
    } else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += char
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""))
}

/** Rows as objects keyed by the header, lower-cased with spaces as "_". */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const keys = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, ""),
  )
  return rows.map((cells) =>
    Object.fromEntries(keys.map((key, i) => [key, (cells[i] ?? "").trim()])),
  )
}

/**
 * One CSV cell. Cells that a spreadsheet would treat as a formula are
 * prefixed with an apostrophe (CSV injection).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Rupee text such as "₹1,250.50" or "1250" to paise; null if not a number. */
export function rupeesToPaise(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]|^Rs\.?/gi, "")
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

/** "2026-10-16", "16-10-2026" or "16/10/2026" as midnight IST. */
export function parseIndianDate(value: string): Date | null {
  const v = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(v)
  const [y, m, d] = iso
    ? [iso[1], iso[2], iso[3]]
    : dmy
      ? [dmy[3], dmy[2], dmy[1]]
      : []
  if (!y) return null
  const date = new Date(`${y}-${m}-${d}T00:00:00+05:30`)
  return Number.isNaN(date.getTime()) || Number(m) > 12 || Number(d) > 31
    ? null
    : date
}

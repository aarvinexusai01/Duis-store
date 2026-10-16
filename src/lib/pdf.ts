/**
 * A one-page PDF of plain text lines, without a dependency. Used for the fake
 * courier's shipping labels, so development has a real file to download.
 * Helvetica covers Latin-1 only: other characters become "?" (and ₹ "Rs.").
 */
export type PdfLine = { text: string; size?: number; bold?: boolean }

const MM = 72 / 25.4

function escape(text: string): string {
  return text
    .replace(/₹/g, "Rs.")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .replace(/[\\()]/g, "\\$&")
}

export function textPdf(
  lines: PdfLine[],
  page: { widthMm: number; heightMm: number } = { widthMm: 100, heightMm: 150 },
): Buffer {
  const width = Math.round(page.widthMm * MM)
  const height = Math.round(page.heightMm * MM)
  const margin = 18
  let y = height - margin
  const ops: string[] = ["BT"]
  for (const line of lines) {
    const size = line.size ?? 10
    y -= size * 1.35
    ops.push(
      `/${line.bold ? "F2" : "F1"} ${size} Tf`,
      `1 0 0 1 ${margin} ${y.toFixed(1)} Tm`,
      `(${escape(line.text)}) Tj`,
    )
  }
  ops.push("ET")
  const content = ops.join("\n")

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ]
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"))
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, "latin1")
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, "latin1")
}

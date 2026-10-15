import sharp from "sharp"

import type { Garment } from "./data"

/**
 * Placeholder imagery: garment silhouettes and geometric banners drawn as SVG
 * and rasterised to PNG. No text (so rendering never depends on installed
 * fonts) and no third-party imagery.
 */

const SILHOUETTES: Record<Garment, string> = {
  tee: "M360 330 L520 260 Q600 330 680 260 L840 330 L1010 500 L900 610 L840 560 L840 1260 L360 1260 L360 560 L300 610 L190 500 Z",
  polo: "M360 330 L520 260 L600 380 L680 260 L840 330 L1010 500 L900 610 L840 560 L840 1260 L360 1260 L360 560 L300 610 L190 500 Z",
  shirt:
    "M370 320 L520 250 L600 360 L680 250 L830 320 L1000 1050 L890 1080 L830 640 L830 1270 L370 1270 L370 640 L310 1080 L200 1050 Z",
  hoodie:
    "M370 360 Q600 120 830 360 L1010 1050 L900 1080 L840 660 L840 1270 L360 1270 L360 660 L300 1080 L190 1050 Z",
  sweatshirt:
    "M370 330 L520 270 Q600 330 680 270 L830 330 L1010 1050 L900 1080 L840 660 L840 1270 L360 1270 L360 660 L300 1080 L190 1050 Z",
  pants: "M410 230 L790 230 L850 1320 L660 1320 L600 640 L540 1320 L350 1320 Z",
  shorts: "M400 420 L800 420 L860 960 L650 960 L600 700 L550 960 L340 960 Z",
}

function darken(hex: string, amount = 0.25): string {
  const value = parseInt(hex.slice(1), 16)
  const channel = (shift: number) =>
    Math.round(((value >> shift) & 255) * (1 - amount))
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

function contrast(hex: string): string {
  const value = parseInt(hex.slice(1), 16)
  const luminance =
    0.299 * ((value >> 16) & 255) +
    0.587 * ((value >> 8) & 255) +
    0.114 * (value & 255)
  return luminance > 150 ? "#111111" : "#f4f4f2"
}

/** A garment in one colour, with an optional chest graphic and a back view. */
export async function garmentImage(options: {
  garment: Garment
  hex: string
  seed: number
  graphic?: boolean
  back?: boolean
}): Promise<Buffer> {
  const { garment, hex, seed, graphic, back } = options
  const ink = contrast(hex)
  const motif = graphic
    ? seed % 2 === 0
      ? `<circle cx="600" cy="650" r="150" fill="none" stroke="${ink}" stroke-width="28"/><circle cx="600" cy="650" r="70" fill="${ink}"/>`
      : `<polygon points="600,500 760,780 440,780" fill="none" stroke="${ink}" stroke-width="28"/><rect x="560" y="660" width="80" height="80" fill="${ink}"/>`
    : ""
  const backSeam = back
    ? `<line x1="600" y1="340" x2="600" y2="1250" stroke="${darken(hex)}" stroke-width="6" stroke-dasharray="20 18"/>`
    : ""
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
    <rect width="1200" height="1500" fill="#efede8"/>
    <rect x="0" y="${1100 + (seed % 5) * 20}" width="1200" height="400" fill="#e4e1da"/>
    <path d="${SILHOUETTES[garment]}" fill="${hex}" stroke="${darken(hex)}" stroke-width="10" stroke-linejoin="round"/>
    ${back ? "" : motif}${backSeam}
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Wide promotional banner in the brand's bold palette. */
export async function bannerImage(
  seed: number,
  palette: [string, string, string],
): Promise<Buffer> {
  const [background, accent, highlight] = palette
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="900" viewBox="0 0 1920 900">
    <rect width="1920" height="900" fill="${background}"/>
    <circle cx="${1300 + (seed % 3) * 120}" cy="450" r="380" fill="${accent}"/>
    <rect x="${180 + (seed % 4) * 40}" y="560" width="760" height="70" fill="${highlight}"/>
    <rect x="${180 + (seed % 4) * 40}" y="660" width="460" height="70" fill="${highlight}"/>
    <polygon points="1500,120 1780,420 1500,720" fill="${highlight}" opacity="0.85"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

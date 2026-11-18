// Builds the Duis logo files in public/brand from the master artwork:
//   node scripts/make-brand-assets.mjs [brand/logo-master.png]
//
// The artwork is the hooded skull in black on white (owner decision
// 2026-11-18). It's traced into vector shapes (imagetracerjs, public domain):
//   - ink: the black shapes;
//   - face: the outline of the whole logo, so the white inside it (the face,
//     the gaps between lines) stays solid instead of showing what's behind.
// Two colourings are written: black on light backgrounds, and the reverse
// (light hood, dark face) for dark ones (header, footer, admin, emails,
// app icons). Square PNGs are rendered from the SVGs for icons and emails.
import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

import sharp from "sharp"

const tracer = createRequire(import.meta.url)("imagetracerjs")

const source = process.argv[2] ?? "brand/logo-master.png"
const OUT = "public/brand"
/** Traced at this size: big enough for detail, small enough for smooth curves. */
const TRACE = 1024
const INK = "#111111"
const PAPER = "#f4f1ea"
const WHITE = "#ffffff"

// ── Masks ──────────────────────────────────────────────────────────────────
const { data, info } = await sharp(source)
  .flatten({ background: WHITE })
  .greyscale()
  .resize(TRACE, TRACE, {
    fit: "contain",
    background: WHITE,
    kernel: "lanczos3",
  })
  .raw()
  .toBuffer({ resolveWithObject: true })
const { width: w, height: h } = info
const ink = new Uint8Array(w * h)
for (let i = 0; i < w * h; i++) ink[i] = data[i] < 128 ? 1 : 0

// Everything white that can be reached from the image's edge is outside.
const outside = new Uint8Array(w * h)
const queue = new Int32Array(w * h)
let head = 0
let tail = 0
const visit = (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const i = y * w + x
  if (outside[i] || ink[i]) return
  outside[i] = 1
  queue[tail++] = i
}
for (let x = 0; x < w; x++) {
  visit(x, 0)
  visit(x, h - 1)
}
for (let y = 0; y < h; y++) {
  visit(0, y)
  visit(w - 1, y)
}
while (head < tail) {
  const i = queue[head++]
  const x = i % w
  const y = (i - x) / w
  visit(x + 1, y)
  visit(x - 1, y)
  visit(x, y + 1)
  visit(x, y - 1)
}

// The logo's bounds, for a tight viewBox.
let minX = w
let minY = h
let maxX = 0
let maxY = 0
for (let i = 0; i < w * h; i++) {
  if (outside[i]) continue
  const x = i % w
  const y = (i - x) / w
  minX = Math.min(minX, x)
  maxX = Math.max(maxX, x)
  minY = Math.min(minY, y)
  maxY = Math.max(maxY, y)
}

// ── Tracing ────────────────────────────────────────────────────────────────
const options = {
  ltres: 0.5,
  qtres: 0.5,
  pathomit: 16,
  colorsampling: 0,
  numberofcolors: 2,
  pal: [
    { r: 0, g: 0, b: 0, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
  ],
  roundcoords: 1,
  linefilter: false,
  rightangleenhance: false,
  blurradius: 0,
  scale: 1,
}

/** One evenodd path for the black pixels of a mask. */
function trace(isBlack) {
  const pixels = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const v = isBlack(i) ? 0 : 255
    pixels.fill(v, i * 4, i * 4 + 3)
    pixels[i * 4 + 3] = 255
  }
  const traced = tracer.imagedataToTracedata(
    { width: w, height: h, data: pixels },
    options,
  )
  const layer = traced.palette.findIndex((c) => c.r === 0)
  let d = ""
  traced.layers[layer].forEach((shape, index) => {
    if (shape.isholepath) return // drawn as part of its parent
    const match = /d="([^"]*)"/.exec(
      tracer.svgpathstring(traced, layer, index, options),
    )
    if (match) d += match[1]
  })
  return d.trim().replace(/\s+/g, " ")
}

const inkPath = trace((i) => ink[i] === 1)
const facePath = trace((i) => outside[i] === 0)
const pad = 4
const viewBox = [
  minX - pad,
  minY - pad,
  maxX - minX + pad * 2,
  maxY - minY + pad * 2,
]

const svg = (hood, face, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(" ")}">${extra}` +
  `<path class="face" fill="${face}" fill-rule="evenodd" d="${facePath}"/>` +
  `<path class="hood" fill="${hood}" fill-rule="evenodd" d="${inkPath}"/></svg>\n`

// ── Files ──────────────────────────────────────────────────────────────────
await mkdir(OUT, { recursive: true })
const onLight = svg(INK, WHITE)
const onDark = svg(PAPER, INK)
await writeFile(path.join(OUT, "logo.svg"), onLight)
await writeFile(path.join(OUT, "logo-on-dark.svg"), onDark)
// Browser tab: follows the browser's light or dark tab bar.
await writeFile(
  path.join(OUT, "icon.svg"),
  svg(
    INK,
    WHITE,
    `<style>@media (prefers-color-scheme: dark){.hood{fill:${PAPER}}.face{fill:${INK}}}</style>`,
  ),
)

/** A square PNG with the logo centred; `fill` is the square's background. */
async function png(name, svgText, size, { margin = 0.06, fill } = {}) {
  const inner = Math.round(size * (1 - margin * 2))
  const logo = await sharp(Buffer.from(svgText), { density: 300 })
    .resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: fill ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, name))
}

// Browsers without SVG icons, and Google's logo (on white).
await png("favicon-32.png", onLight, 32, { margin: 0 })
await png("favicon-64.png", onLight, 64, { margin: 0 })
await png("emblem-512.png", onLight, 512)
// Emails (the header is ink) and the link-preview card (ink).
await png("emblem-128.png", onDark, 128)
await png("logo-on-dark-512.png", onDark, 512)
// Home-screen icons on the store's ink: iOS and Android would otherwise fill
// transparency with their own colour. The margin keeps clear of the corners.
await png("apple-touch-icon.png", onDark, 180, { margin: 0.14, fill: INK })
await png("icon-192.png", onDark, 192, { margin: 0.14, fill: INK })
await png("icon-512.png", onDark, 512, { margin: 0.14, fill: INK })

console.log(
  `logo traced: viewBox ${viewBox.join(" ")}, ${Math.round(onLight.length / 1024)} KB SVG → ${OUT}`,
)

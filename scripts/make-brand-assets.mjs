// Builds the Duis emblem files in public/brand from the master artwork:
//   node scripts/make-brand-assets.mjs path/to/emblem.jpg
//
// The artwork is a round emblem on a solid black square. The black that
// surrounds it (everything dark that touches the image's edge) becomes
// transparent, so the emblem sits cleanly on light and dark surfaces; the
// emblem's own blacks, inside the ring, are kept. The result is cropped to
// the emblem and written at the sizes the app uses.
import { mkdir } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

const source = process.argv[2]
if (!source) {
  console.error("usage: node scripts/make-brand-assets.mjs <emblem.jpg>")
  process.exit(1)
}
const OUT = "public/brand"
// Pixels at most this bright, reachable from the edge, are background (the
// faint glow around the ring included).
const BACKGROUND_MAX = 60

const { data, info } = await sharp(source)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const { width: w, height: h } = info
const brightness = (i) =>
  Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2])

// Flood fill the background from every edge pixel.
const background = new Uint8Array(w * h)
const queue = new Int32Array(w * h)
let head = 0
let tail = 0
const visit = (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const i = y * w + x
  if (background[i] || brightness(i) > BACKGROUND_MAX) return
  background[i] = 1
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

// The rings have small openings, so the fill can creep inside the emblem.
// Only the area around the ring may become transparent: an ellipse fitted to
// the emblem's bounds, shrunk a little, protects everything inside it.
let minX = w
let minY = h
let maxX = 0
let maxY = 0
for (let i = 0; i < w * h; i++) {
  if (background[i]) continue
  const x = i % w
  const y = (i - x) / w
  if (x < minX) minX = x
  if (x > maxX) maxX = x
  if (y < minY) minY = y
  if (y > maxY) maxY = y
}
const cx = (minX + maxX) / 2
const cy = (minY + maxY) / 2
const rx = (maxX - minX) / 2
const ry = (maxY - minY) / 2
const INSIDE = 0.975

// Alpha: background outside the ring transparent, everything else opaque,
// then softened by a pixel so the edge isn't jagged.
const alpha = Buffer.alloc(w * h)
for (let i = 0; i < w * h; i++) {
  const x = i % w
  const y = (i - x) / w
  const d = Math.hypot((x - cx) / rx, (y - cy) / ry)
  alpha[i] = background[i] && d > INSIDE ? 0 : d > 1.01 ? 0 : 255
}
const softAlpha = await sharp(alpha, {
  raw: { width: w, height: h, channels: 1 },
})
  .blur(1.2)
  .extractChannel(0) // sharp would otherwise hand back three channels
  .raw()
  .toBuffer()
if (softAlpha.length !== w * h) throw new Error("unexpected alpha size")

const rgba = Buffer.alloc(w * h * 4)
for (let i = 0; i < w * h; i++) {
  rgba[i * 4] = data[i * 3]
  rgba[i * 4 + 1] = data[i * 3 + 1]
  rgba[i * 4 + 2] = data[i * 3 + 2]
  rgba[i * 4 + 3] = softAlpha[i]
}

// A square crop around the emblem with a little breathing room.
const side = Math.max(maxX - minX, maxY - minY) + 8
const left = Math.max(0, Math.round((minX + maxX - side) / 2))
const top = Math.max(0, Math.round((minY + maxY - side) / 2))
const square = Math.min(side, w - left, h - top)
const master = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
  .extract({ left, top, width: square, height: square })
  .png()
  .toBuffer()

await mkdir(OUT, { recursive: true })
const write = async (name, size, options = {}) => {
  let image = sharp(master).resize(size, size, { kernel: "lanczos3" })
  if (options.background) {
    // Home-screen icons get the store's ink behind the emblem (iOS and
    // Android would otherwise fill transparency with their own colour).
    const padding = Math.round(size * 0.08)
    image = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: options.background,
      },
    }).composite([
      {
        input: await sharp(master)
          .resize(size - padding * 2, size - padding * 2)
          .png()
          .toBuffer(),
        left: padding,
        top: padding,
      },
    ])
  }
  const file = path.join(OUT, name)
  if (name.endsWith(".webp"))
    await image.webp({ quality: 88, alphaQuality: 100 }).toFile(file)
  else await image.png({ compressionLevel: 9 }).toFile(file)
  console.log(`wrote ${file}`)
}

const INK = "#111111"
await write("emblem-96.webp", 96) // header, footer, sign-in and checkout headers (2x)
await write("emblem-256.webp", 256) // larger placements, share card source
await write("emblem-512.png", 512) // share card
await write("emblem-128.png", 128) // emails (PNG: some mail apps lack WebP)
await write("favicon-32.png", 32)
await write("favicon-64.png", 64)
await write("apple-touch-icon.png", 180, { background: INK })
await write("icon-192.png", 192, { background: INK })
await write("icon-512.png", 512, { background: INK })
console.log(`emblem box in source: x ${minX}-${maxX}, y ${minY}-${maxY}`)

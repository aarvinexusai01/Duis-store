// Downloads the demo photos listed in src/db/seed/photos/manifest.json from
// Pexels and stores them at the sizes the seed uploads (product 4:5, banner
// 1920×900). Already-downloaded files are skipped.
//   node scripts/fetch-demo-photos.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import sharp from "sharp"

const DIR = path.resolve("src/db/seed/photos")
const manifest = JSON.parse(
  readFileSync(path.join(DIR, "manifest.json"), "utf8"),
)

async function save(id, { width, height, position }) {
  const file = path.join(DIR, `${id}.jpg`)
  if (existsSync(file)) return
  const url = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width * 2}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Pexels ${id}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const out = await sharp(bytes)
    .resize(width, height, { fit: "cover", position })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer()
  writeFileSync(file, out)
  console.log(`${id}.jpg ${Math.round(out.length / 1024)} KB`)
}

for (const [pair, ids] of Object.entries(manifest.products)) {
  // Keep the legs in frame for trousers and shorts.
  const position = /^(pants|shorts):/.test(pair) ? "bottom" : "centre"
  for (const id of ids) await save(id, { width: 1200, height: 1500, position })
}
for (const id of manifest.banners)
  await save(id, { width: 1920, height: 900, position: "attention" })

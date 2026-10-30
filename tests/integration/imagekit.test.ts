import { createServer, type Server } from "node:http"

import { sql } from "drizzle-orm"
import sharp, { type Stats } from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { moveMediaToImageKit, uploadImage } from "@/features/media"
import { processImage } from "@/features/media/pipeline"
import { storeMediaFiles } from "@/server/storage/local"
import { getDb } from "@/server/db/client"

import { asSystem } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeImage } from "../helpers/images"

/**
 * Uploads to ImageKit (Phase 10), against a stand-in that records what the
 * real upload API would receive.
 */

type Received = {
  folder: string
  fileName: string
  overwrite: string
  unique: string
  auth: string
  data: Buffer
}
let received: Received[] = []
let failNext = 0
let server: Server

process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT = "https://ik.imagekit.io/TEST"
process.env.IMAGEKIT_PRIVATE_KEY = "private_test_key_123"

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", async () => {
      if (failNext > 0) {
        failNext -= 1
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ message: "down" }))
        return
      }
      const form = await new Response(Buffer.concat(chunks), {
        headers: { "content-type": req.headers["content-type"]! },
      }).formData()
      const file = form.get("file") as File
      received.push({
        folder: String(form.get("folder")),
        fileName: String(form.get("fileName")),
        overwrite: String(form.get("overwriteFile")),
        unique: String(form.get("useUniqueFileName")),
        auth: req.headers.authorization ?? "",
        data: Buffer.from(await file.arrayBuffer()),
      })
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ fileId: "f" }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as { port: number }
  process.env.IMAGEKIT_UPLOAD_URL = `http://127.0.0.1:${port}/upload`
})

afterAll(() => {
  server.close()
  delete process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
  delete process.env.IMAGEKIT_PRIVATE_KEY
  delete process.env.IMAGEKIT_UPLOAD_URL
})

beforeEach(() => {
  received = []
  failNext = 0
})

closeConnectionsAfterAll()

const unique = () =>
  makeImage({
    width: 2400,
    height: 3000,
    colour: `rgb(${Math.floor(Math.random() * 256)}, 90, 40)`,
    exifCopyright: "secret camera owner",
  })

async function bottomRight(image: Buffer) {
  const { width, height } = await sharp(image).metadata()
  const size = Math.round(width! * 0.1)
  return sharp(image)
    .extract({
      left: width! - size - Math.round(width! * 0.03),
      top: height! - size - Math.round(width! * 0.03),
      width: size,
      height: size,
    })
    .stats()
}

describe("a product photo", () => {
  it("is stored as a capped clean copy and a watermarked full-size zoom", async () => {
    const uploaded = await uploadImage(asSystem(), {
      bytes: await unique(),
      purpose: "product",
    })
    const hex = uploaded.storageKey.slice(4)
    expect(uploaded.storageKey).toMatch(/^ikp-[a-f0-9]{32}$/)
    expect(uploaded.url).toBe(
      `https://ik.imagekit.io/TEST/duis/${hex}/clean.webp?tr=w-640`,
    )
    expect(received.map((r) => r.fileName).toSorted()).toEqual([
      "clean.webp",
      "zoom.webp",
    ])
    for (const file of received) {
      expect(file.folder).toBe(`/duis/${hex}`)
      expect(file.overwrite).toBe("true")
      expect(file.unique).toBe("false")
      expect(file.auth).toBe(
        `Basic ${Buffer.from("private_test_key_123:").toString("base64")}`,
      )
      // Location and camera details never leave our server.
      expect((await sharp(file.data).metadata()).exif).toBeUndefined()
    }
    const clean = received.find((r) => r.fileName === "clean.webp")!.data
    const zoom = received.find((r) => r.fileName === "zoom.webp")!.data
    expect((await sharp(clean).metadata()).width).toBe(960)
    expect((await sharp(zoom).metadata()).width).toBe(1920)

    // The emblem: the zoom copy's bottom-right corner isn't the plain colour.
    const cleanCorner = await bottomRight(clean)
    const zoomCorner = await bottomRight(zoom)
    const spread = (s: Stats) => s.channels.reduce((sum, c) => sum + c.stdev, 0)
    expect(spread(cleanCorner)).toBeLessThan(2)
    expect(spread(zoomCorner)).toBeGreaterThan(10)
  })
})

describe("a content image", () => {
  it("is stored once, clean, at full size", async () => {
    const uploaded = await uploadImage(asSystem(), { bytes: await unique() })
    expect(uploaded.storageKey).toMatch(/^ikc-[a-f0-9]{32}$/)
    expect(received.map((r) => r.fileName)).toEqual(["clean.webp"])
    // Full size: only the 2,560 px limit on the long edge applies (3000 → 2560).
    const stored = await sharp(received[0]!.data).metadata()
    expect([stored.width, stored.height]).toEqual([2048, 2560])
  })

  it("re-uploaded as a product photo, gets the product copies and keeps its id", async () => {
    const bytes = await unique()
    const content = await uploadImage(asSystem(), { bytes })
    received = []
    const product = await uploadImage(asSystem(), { bytes, purpose: "product" })
    expect(product.id).toBe(content.id)
    expect(product.storageKey).toBe(content.storageKey.replace("ikc-", "ikp-"))
    expect(received.map((r) => r.fileName).toSorted()).toEqual([
      "clean.webp",
      "zoom.webp",
    ])
    // The same photo uploaded again as content stays a product photo.
    const again = await uploadImage(asSystem(), { bytes })
    expect(again).toMatchObject({ id: content.id, reused: true })
    expect(again.storageKey).toBe(product.storageKey)
  })
})

describe("when ImageKit fails", () => {
  it("retries a server error once", async () => {
    failNext = 1
    const uploaded = await uploadImage(asSystem(), { bytes: await unique() })
    expect(uploaded.storageKey).toMatch(/^ikc-/)
  })

  it("saves nothing if the upload keeps failing", async () => {
    failNext = 10
    const bytes = await unique()
    await expect(uploadImage(asSystem(), { bytes })).rejects.toThrow(
      /ImageKit upload/,
    )
    const rows = await getDb().execute<{ n: number }>(sql`
      select count(*)::int as n from media_assets
      where sha256 = encode(sha256(${bytes}), 'hex')`)
    expect(rows.rows[0]!.n).toBe(0)
  })
})

describe("moving existing images (10c)", () => {
  /** An asset stored the old way, on the local media volume. */
  async function localAsset(): Promise<{ id: string; key: string }> {
    const bytes = await unique()
    const processed = await processImage(bytes)
    const { createHash } = await import("node:crypto")
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const key = sha256.slice(0, 32)
    await storeMediaFiles(key, processed.files)
    const { rows } = await getDb().execute<{ id: string }>(sql`
      insert into media_assets (storage_key, sha256, mime, bytes, width, height, renditions)
      values (${key}, ${sha256}, 'image/webp', 1, ${processed.width}, ${processed.height}, '[320,640,960,1280,1920]')
      returning id`)
    return { id: rows[0]!.id, key }
  }

  it("moves product photos with their zoom copy, other images clean, once", async () => {
    const product = await localAsset()
    const content = await localAsset()
    const fx = await createProductFixture()
    await getDb().execute(sql`
      insert into product_media (product_id, media_id) values (${fx.productId}, ${product.id})`)

    const result = await moveMediaToImageKit({})
    expect(result.failed).toBe(0)
    const keys = await getDb().execute<{ id: string; storage_key: string }>(sql`
      select id, storage_key from media_assets where id in (${product.id}, ${content.id})`)
    const keyOf = (id: string) =>
      keys.rows.find((r) => r.id === id)!.storage_key
    expect(keyOf(product.id)).toBe(`ikp-${product.key}`)
    expect(keyOf(content.id)).toBe(`ikc-${content.key}`)
    const folders = (key: string) =>
      received
        .filter((r) => r.folder === `/duis/${key}`)
        .map((r) => r.fileName)
        .toSorted()
    expect(folders(product.key)).toEqual(["clean.webp", "zoom.webp"])
    expect(folders(content.key)).toEqual(["clean.webp"])

    // Nothing left to move.
    received = []
    expect(await moveMediaToImageKit({})).toMatchObject({ moved: 0, failed: 0 })
    expect(received).toEqual([])
  })
})

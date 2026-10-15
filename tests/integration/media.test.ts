import { readdir } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { setProductMedia } from "@/features/catalog"
import { deleteMedia, uploadImage } from "@/features/media"
import { MEDIA_WIDTHS } from "@/lib/image-loader"
import { readMediaFile } from "@/server/storage/local"

import { asSystem } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeImage, makeUniqueImage } from "../helpers/images"

closeConnectionsAfterAll()

const system = asSystem()

describe("image upload pipeline", () => {
  it("re-encodes to WebP, strips metadata and writes every width", async () => {
    const original = await makeImage({
      width: 1200,
      height: 1500,
      exifCopyright: "secret-gps-and-camera",
    })
    expect((await sharp(original).metadata()).exif).toBeDefined()

    const uploaded = await uploadImage(system, {
      bytes: original,
      filename: "front.jpg",
      altText: "Front",
    })
    expect(uploaded).toMatchObject({ width: 1200, height: 1500, reused: false })

    const files = await readdir(
      path.join(process.env.MEDIA_ROOT!, uploaded.storageKey),
    )
    expect(files.sort()).toEqual(
      ["orig.webp", ...MEDIA_WIDTHS.map((w) => `${w}.webp`)].sort(),
    )

    const master = await readMediaFile(uploaded.storageKey, "orig.webp")
    const meta = await sharp(master!).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.exif).toBeUndefined()

    // Small widths shrink; widths beyond the original are not enlarged.
    expect(
      (
        await sharp(
          (await readMediaFile(uploaded.storageKey, "320.webp"))!,
        ).metadata()
      ).width,
    ).toBe(320)
    expect(
      (
        await sharp(
          (await readMediaFile(uploaded.storageKey, "1920.webp"))!,
        ).metadata()
      ).width,
    ).toBe(1200)
  })

  it("reuses the asset for identical bytes", async () => {
    const bytes = await makeUniqueImage()
    const first = await uploadImage(system, { bytes })
    const second = await uploadImage(system, { bytes })
    expect(second).toMatchObject({ id: first.id, reused: true })
  })

  it("rejects SVG, non-images, tiny images and oversized files", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><script>alert(1)</script></svg>',
    )
    await expect(uploadImage(system, { bytes: svg })).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
    })
    await expect(
      uploadImage(system, { bytes: Buffer.from("not an image") }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
    })
    await expect(
      uploadImage(system, {
        bytes: await makeImage({ width: 120, height: 120 }),
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
    })
    const huge = new Uint8Array(
      Number(process.env.MEDIA_MAX_UPLOAD_BYTES ?? 15_728_640) + 1,
    )
    await expect(uploadImage(system, { bytes: huge })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    })
  })

  it("refuses to delete an image that is in use", async () => {
    const fx = await createProductFixture()
    const used = await uploadImage(system, { bytes: await makeUniqueImage() })
    await setProductMedia(system, {
      productId: fx.productId,
      items: [{ mediaId: used.id }],
    })
    await expect(deleteMedia(system, { id: used.id })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { usage: [{ kind: "product", count: 1 }] },
    })

    const unused = await uploadImage(system, { bytes: await makeUniqueImage() })
    await expect(deleteMedia(system, { id: unused.id })).resolves.toEqual({
      id: unused.id,
    })
  })

  it("serves only well-formed media paths", async () => {
    expect(await readMediaFile("../../etc", "passwd")).toBeNull()
    expect(await readMediaFile("a".repeat(32), "evil.svg")).toBeNull()
  })
})

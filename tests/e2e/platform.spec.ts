import { createHmac } from "node:crypto"

import { expect, test } from "@playwright/test"
import pg from "pg"

test("mounts the auth API", async ({ request }) => {
  const response = await request.get("/api/auth/ok")
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
})

test("accepts revalidation requests only with a valid signature", async ({
  request,
}) => {
  const body = JSON.stringify({ tags: ["products:list"] })
  const headers = { "content-type": "application/json" }

  const unsigned = await request.post("/api/internal/revalidate", {
    data: body,
    headers: {
      ...headers,
      "x-duis-timestamp": String(Date.now()),
      "x-duis-signature": "00",
    },
  })
  expect(unsigned.status()).toBe(401)

  const timestamp = String(Date.now())
  const signature = createHmac(
    "sha256",
    process.env.INTERNAL_REVALIDATE_SECRET!,
  )
    .update(`${timestamp}.${body}`)
    .digest("hex")
  const signed = await request.post("/api/internal/revalidate", {
    data: body,
    headers: {
      ...headers,
      "x-duis-timestamp": timestamp,
      "x-duis-signature": signature,
    },
  })
  expect(signed.status()).toBe(200)
  expect(await signed.json()).toEqual({ revalidated: 1 })
})

test("serves media immutably and only for well-formed paths", async ({
  request,
}) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const { rows } = await client.query<{ storage_key: string }>(
    "select storage_key from media_assets order by created_at limit 1",
  )
  await client.end()
  test.skip(rows.length === 0, "no media — run `npm run db:seed` first")

  const image = await request.get(`/media/${rows[0]!.storage_key}/640.webp`)
  expect(image.status()).toBe(200)
  expect(image.headers()["content-type"]).toBe("image/webp")
  expect(image.headers()["cache-control"]).toContain("immutable")

  expect(
    (await request.get(`/media/${"a".repeat(32)}/640.webp`)).status(),
  ).toBe(404)
  expect(
    (await request.get(`/media/${rows[0]!.storage_key}/evil.svg`)).status(),
  ).toBe(404)
})

test("refuses uploads without a staff session", async ({ request }) => {
  const response = await request.post("/api/media/upload", {
    multipart: {
      file: {
        name: "a.png",
        mimeType: "image/png",
        buffer: Buffer.from("not really"),
      },
    },
  })
  expect(response.status()).toBe(401)
  expect((await response.json()).error.code).toBe("UNAUTHENTICATED")
})

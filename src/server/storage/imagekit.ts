import "server-only"

import { getServerEnv } from "@/config/env"
import { imagekitFolder } from "@/lib/image-loader"

import type { StoredFile } from "./local"

/**
 * ImageKit storage for public images (Phase 10, ADR-006's other adapter).
 * Files go to /duis/{hex}/{name}, with fixed names, so an upload retried
 * after a failure simply overwrites. The private key never leaves the
 * server; ImageKit serves the files from its CDN (lib/image-loader).
 */

const TIMEOUT_MS = 30_000

export function imagekitEnabled(): boolean {
  const env = getServerEnv()
  return Boolean(
    env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT && env.IMAGEKIT_PRIVATE_KEY,
  )
}

export class ImageKitError extends Error {}

export async function uploadToImageKit(
  hex: string,
  files: StoredFile[],
): Promise<void> {
  const env = getServerEnv()
  if (!env.IMAGEKIT_PRIVATE_KEY)
    throw new ImageKitError("ImageKit is not configured")
  const auth = `Basic ${Buffer.from(`${env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64")}`
  for (const file of files) {
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const form = new FormData()
      form.set(
        "file",
        new Blob([new Uint8Array(file.data)], { type: "image/webp" }),
        file.name,
      )
      form.set("fileName", file.name)
      form.set("folder", imagekitFolder(hex))
      form.set("useUniqueFileName", "false")
      form.set("overwriteFile", "true")
      try {
        const response = await fetch(env.IMAGEKIT_UPLOAD_URL, {
          method: "POST",
          headers: { authorization: auth },
          body: form,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (response.ok) {
          lastError = undefined
          break
        }
        const body = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        lastError = new ImageKitError(
          `ImageKit upload of ${file.name} failed: ${body?.message ?? response.status}`,
        )
        // A client error won't fix itself on retry.
        if (response.status < 500) break
      } catch (err) {
        lastError = err
      }
    }
    if (lastError) throw lastError
  }
}

import "server-only"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { getServerEnv } from "@/config/env"

/**
 * Local-volume implementation of the media StorageAdapter (ADR-006). Layout:
 * MEDIA_ROOT/{key}/{orig|width}.webp. Keys and file names are validated, so
 * no request can address a path outside the media root.
 */
export const MEDIA_KEY = /^[a-f0-9]{32}$/
export const MEDIA_FILE = /^(orig|\d{3,4})\.webp$/

export type StoredFile = { name: string; data: Buffer }

function mediaRoot(): string {
  return path.resolve(getServerEnv().MEDIA_ROOT)
}

function assertSafe(key: string, name?: string) {
  if (!MEDIA_KEY.test(key) || (name !== undefined && !MEDIA_FILE.test(name))) {
    throw new Error("invalid media path")
  }
}

/**
 * Writes all files for a key into a temporary directory, then renames it into
 * place in one step, so readers never see a half-written asset. If the key
 * already exists (identical upload), the existing files are kept.
 */
export async function storeMediaFiles(
  key: string,
  files: StoredFile[],
): Promise<void> {
  assertSafe(key)
  files.forEach((file) => assertSafe(key, file.name))

  const root = mediaRoot()
  await mkdir(root, { recursive: true })
  const staging = path.join(root, `.staging-${key}-${randomUUID()}`)
  await mkdir(staging)
  try {
    for (const file of files)
      await writeFile(path.join(staging, file.name), file.data)
    await rename(staging, path.join(root, key))
  } catch (err) {
    await rm(staging, { recursive: true, force: true })
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "EEXIST" && code !== "ENOTEMPTY") throw err
  }
}

export async function readMediaFile(
  key: string,
  name: string,
): Promise<Buffer | null> {
  if (!MEDIA_KEY.test(key) || !MEDIA_FILE.test(name)) return null
  try {
    return await readFile(path.join(mediaRoot(), key, name))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

export function mediaPath(key: string, name: string): string {
  assertSafe(key, name)
  return path.join(mediaRoot(), key, name)
}

/** Where moved files are kept: not addressable as /media/{key} (Nginx refuses /media/.*). */
export const MOVED_DIR = ".moved"

/**
 * Takes an asset's files out of public reach once they live elsewhere
 * (Phase 10: ImageKit), keeping them on the volume (and in backups) in
 * MOVED_DIR. Returns false when there was nothing to move.
 */
export async function hideMediaFiles(key: string): Promise<boolean> {
  assertSafe(key)
  const root = mediaRoot()
  try {
    await mkdir(path.join(root, MOVED_DIR), { recursive: true })
    await rename(path.join(root, key), path.join(root, MOVED_DIR, key))
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

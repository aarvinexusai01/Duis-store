import "server-only"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { getServerEnv } from "@/config/env"

/**
 * Files that are never served publicly (shipping labels hold customer
 * addresses). Layout: STORAGE_PRIVATE_ROOT/{area}/{name}. Staff download them
 * through a route that checks permissions.
 */
const AREAS = ["labels"] as const
export type PrivateArea = (typeof AREAS)[number]
const NAME = /^[a-z0-9-]{1,80}\.(pdf)$/

function target(area: PrivateArea, name: string): string {
  if (!AREAS.includes(area) || !NAME.test(name)) {
    throw new Error("invalid private file path")
  }
  return path.join(
    path.resolve(getServerEnv().STORAGE_PRIVATE_ROOT),
    area,
    name,
  )
}

/** Writes atomically (temp file, then rename), so readers never see half a file. */
export async function writePrivateFile(
  area: PrivateArea,
  name: string,
  data: Buffer,
): Promise<string> {
  const file = target(area, name)
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, data)
  await rename(temp, file)
  return `${area}/${name}`
}

export async function readPrivateFile(key: string): Promise<Buffer | null> {
  const [area, name, ...rest] = key.split("/")
  if (rest.length > 0 || !area || !name) return null
  try {
    return await readFile(target(area as PrivateArea, name))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}

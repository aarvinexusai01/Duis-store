import { parseArgs } from "node:util"

import { moveMediaToImageKit } from "@/features/media"
import { closeDb } from "@/server/db/client"

/**
 * Moves existing images to ImageKit (Phase 10c; runbook: cache-and-search):
 *   ops/compose run --rm --no-deps worker node dist/media-to-imagekit.mjs [--dry-run]
 * Afterwards, empty the shared cache and restart the web copies so cached
 * pages pick up the new image links.
 */
async function main() {
  const { values } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false } },
  })
  const result = await moveMediaToImageKit({
    dryRun: values["dry-run"],
    log: (line) => console.log(`  ${line}`),
  })
  console.log(
    `${values["dry-run"] ? "Would move" : "Moved"} ${result.moved} of ${result.total} images; ${result.failed} failed.`,
  )
  if (result.failed > 0) process.exitCode = 1
}

main()
  .catch((err: unknown) => {
    console.error((err as Error).message)
    process.exitCode = 1
  })
  .finally(() => closeDb())

// Bundles the non-Next entry points (worker, migrate) into self-contained ESM
// files in dist/, so the runtime image needs no node_modules for them.
//   npm run build:server
import { rm } from "node:fs/promises"

import { build } from "esbuild"

const OUT_DIR = "dist"

// The output is ESM but bundles CommonJS dependencies (pg, pino), which
// expect require/__filename/__dirname to exist.
const commonJsShim = [
  'import { createRequire as __duisCreateRequire } from "node:module";',
  'import { fileURLToPath as __duisFileURLToPath } from "node:url";',
  'import { dirname as __duisDirname } from "node:path";',
  "const require = __duisCreateRequire(import.meta.url);",
  "const __filename = __duisFileURLToPath(import.meta.url);",
  "const __dirname = __duisDirname(__filename);",
].join("\n")

await rm(OUT_DIR, { recursive: true, force: true })

await build({
  entryPoints: {
    worker: "src/worker/index.ts",
    migrate: "src/db/migrate.ts",
    seed: "src/db/seed/index.ts",
    "create-super-admin": "src/cli/create-super-admin.ts",
  },
  outdir: OUT_DIR,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  packages: "bundle",
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  // pg loads pg-native lazily and only when explicitly requested. sharp is a
  // native module: it stays in node_modules (the standalone build traces it).
  external: ["pg-native", "sharp"],
  alias: { "server-only": "./scripts/stubs/server-only.mjs" },
  banner: { js: commonJsShim },
  legalComments: "none",
  logLevel: "info",
})

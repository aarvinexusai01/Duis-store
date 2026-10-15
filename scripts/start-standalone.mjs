// Runs the production build the way the Docker image does. With
// `output: "standalone"`, `next start` is unsupported; the minimal server.js
// needs public/ and .next/static copied next to it.
//   npm run build && npm start
import { spawn } from "node:child_process"
import { cpSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = ".next/standalone"

// server.js changes into its own directory on start, so relative paths from
// .env (MEDIA_ROOT) must be made absolute here. Existing variables win.
if (existsSync(".env")) process.loadEnvFile(".env")
const env = {
  ...process.env,
  MEDIA_ROOT: path.resolve(process.env.MEDIA_ROOT ?? "storage/media"),
}

if (!existsSync(`${ROOT}/server.js`)) {
  console.error("No standalone build found. Run `npm run build` first.")
  process.exit(1)
}

cpSync("public", `${ROOT}/public`, { recursive: true })
cpSync(".next/static", `${ROOT}/.next/static`, { recursive: true })

const server = spawn(process.execPath, [`${ROOT}/server.js`], {
  stdio: "inherit",
  env,
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal))
}
server.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})

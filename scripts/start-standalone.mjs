// Runs the production build the way the Docker image does. With
// `output: "standalone"`, `next start` is unsupported; the minimal server.js
// needs public/ and .next/static copied next to it.
//   npm run build && npm start
import { spawn } from "node:child_process"
import { cpSync, existsSync } from "node:fs"

const ROOT = ".next/standalone"

if (!existsSync(`${ROOT}/server.js`)) {
  console.error("No standalone build found. Run `npm run build` first.")
  process.exit(1)
}

cpSync("public", `${ROOT}/public`, { recursive: true })
cpSync(".next/static", `${ROOT}/.next/static`, { recursive: true })

const server = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", `${ROOT}/server.js`],
  { stdio: "inherit" },
)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal))
}
server.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})

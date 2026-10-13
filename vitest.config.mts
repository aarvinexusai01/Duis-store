import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import { defineConfig } from "vitest/config"

// Load .env files the same way Next.js does (NODE_ENV=test). @next/env is
// CommonJS, so take the function from the default export.
nextEnv.loadEnvConfig(process.cwd())

const fromRoot = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      "server-only": fromRoot("./scripts/stubs/server-only.mjs"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["./tests/integration/global-setup.ts"],
          // Tests share one database; run files one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/components/ui/**", "src/**/*.test.ts"],
    },
  },
})

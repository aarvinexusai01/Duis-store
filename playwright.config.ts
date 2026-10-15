import { loadEnvConfig } from "@next/env"
import { defineConfig, devices } from "@playwright/test"

// Tests read the same .env as the server (secrets for signed requests, DB).
loadEnvConfig(process.cwd())

// A dedicated port, so a stray server on 3000 is never mistaken for the app.
const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

/**
 * E2E runs against the standalone production build (`npm run build` first),
 * as the Next.js testing guide recommends. Locally a server already running
 * on the E2E port is reused.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        // The browser origin must match APP_URL (Better Auth origin checks),
        // and APP_ENV=test enables the fake-OTP endpoint used to sign in.
        env: {
          PORT: String(PORT),
          APP_URL: baseURL,
          APP_ENV: "test",
          INTERNAL_REVALIDATE_URLS: baseURL,
        },
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})

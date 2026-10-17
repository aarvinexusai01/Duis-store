import { loadEnvConfig } from "@next/env"
import { defineConfig, devices } from "@playwright/test"

import { answeredConsent } from "./tests/e2e/support/consent"

// Tests read the same .env as the server (secrets for signed requests, DB).
loadEnvConfig(process.cwd())

// A dedicated port, so a stray server on 3000 is never mistaken for the app.
const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`
// A second replica, to prove published content reaches every replica.
const SECOND_PORT = Number(process.env.E2E_SECOND_PORT ?? 3102)
const secondReplicaURL = `http://localhost:${SECOND_PORT}`

// What both replicas and the worker share.
const sharedEnv = {
  // The browser origin must match APP_URL (Better Auth origin checks),
  // and APP_ENV=test enables the fake-OTP endpoint used to sign in.
  APP_URL: baseURL,
  APP_ENV: "test",
  // Never real payments in automated tests, whatever .env says.
  PAYMENT_PROVIDER: "fake",
  // Placeholder IDs: the consent spec intercepts both scripts, so nothing
  // reaches Google or Meta.
  GA4_MEASUREMENT_ID: "G-E2ETEST000",
  META_PIXEL_ID: "1000000000000",
  INTERNAL_REVALIDATE_URLS: `${baseURL},${secondReplicaURL}`,
}

/**
 * E2E runs against the standalone production build and the worker bundle
 * (`npm run build && npm run build:server` first), as the Next.js testing
 * guide recommends. Locally a server already running on an E2E port is
 * reused. The worker only clears caches, so other jobs aren't processed
 * mid-test; stop any other worker on the same database while it runs.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Two replicas and a worker already share the machine with the browsers;
  // more than two test workers overloads a laptop. E2E_WORKERS overrides.
  workers: Number(process.env.E2E_WORKERS ?? 2),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // A cold production server under parallel workers can take a few seconds
  // to answer its first requests.
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    storageState: answeredConsent(baseURL),
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "npm run start",
          env: { ...sharedEnv, PORT: String(PORT) },
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: "npm run start",
          env: { ...sharedEnv, PORT: String(SECOND_PORT) },
          url: `${secondReplicaURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: "npm run worker",
          env: {
            ...sharedEnv,
            WORKER_QUEUES: "cache.revalidate",
            SERVICE_NAME: "e2e-worker",
            LOG_LEVEL: "info",
            WORKER_HEARTBEAT_FILE: "/tmp/duis-e2e-worker-heartbeat",
          },
          wait: { stdout: /worker started/ },
          timeout: 60_000,
        },
      ],
})

import { defineConfig, devices } from "@playwright/test"

/**
 * The HTTP race suite (doc/06 Phase 7, race campaign) runs against a running
 * production stack: Nginx and both app copies, not a dev server. Start one
 * with ops/local/init.sh and ops/deploy.sh (runbook: local-stack), then:
 *   DUIS_STACK_DIR=~/duis-server npm run test:race
 */
export default defineConfig({
  testDir: "tests/race",
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.RACE_BASE_URL ?? "https://localhost:8443",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
})

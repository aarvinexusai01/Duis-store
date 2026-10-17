import { expect, type Page } from "@playwright/test"
import pg from "pg"

import { totp } from "../../helpers/totp"

/** A fresh staff account per run, so two-factor setup always starts clean. */
export async function createStaff(
  page: Page,
  role:
    | "super_admin"
    | "store_admin"
    | "content_manager"
    | "content_editor"
    | "fulfilment_staff"
    | "support_agent",
) {
  const email = `e2e-${role}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@duis.test`
  const password = "E2e-Staff-Passw0rd!"
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    data: { email, password, name: `E2E ${role}` },
    headers: {
      origin: new URL(
        page.url() === "about:blank" ? "http://localhost:3100" : page.url(),
      ).origin,
    },
  })
  expect(signUp.ok()).toBe(true)
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query(
    "update users set role = $1, email_verified = true where email = $2",
    [role, email],
  )
  await client.end()
  return { email, password }
}

export async function signInAndSetUpTwoFactor(
  page: Page,
  account: { email: string; password: string },
) {
  await page.goto("/login?next=/admin")
  await page.waitForLoadState("networkidle")
  await page.getByRole("tab", { name: "Email" }).click()
  await page.getByRole("textbox", { name: "Email" }).fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  // Staff without two-factor are sent to set it up first.
  await page.waitForURL("**/admin/two-factor")
  await page.waitForLoadState("networkidle")
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Continue" }).click()
  const key = await page.locator("code").textContent()
  await page.getByLabel("6-digit code").fill(totp(key!.trim()))
  await page.getByRole("button", { name: "Verify and turn on" }).click()
  await expect(page.getByText("Two-factor authentication is on.")).toBeVisible()
  await page.getByRole("button", { name: "Continue to admin" }).click()
  await expect(
    page.getByRole("heading", { level: 1, name: "Dashboard" }),
  ).toBeVisible()
}

import { expect, test } from "@playwright/test"
import pg from "pg"

import { NOTICE_VERSION } from "../../src/lib/privacy"
import { tickConsent } from "./support/consent"
import { signInWithOtp } from "./support/shop"
import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

test("the Privacy Notice stands on its own, in English and Hindi", async ({
  page,
}) => {
  await page.goto("/policies/privacy-notice")
  await expect(
    page.getByRole("heading", { level: 1, name: "Privacy Notice" }),
  ).toBeVisible()
  await expect(page.getByText(/Data Protection Board of India/)).toBeVisible()
  await expect(
    page.getByText(`Notice version: ${NOTICE_VERSION}`),
  ).toBeVisible()
  await page.getByRole("link", { name: "हिंदी में पढ़ें" }).click()
  await expect(page).toHaveURL(/\/policies\/privacy-notice\/hi$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "गोपनीयता सूचना" }),
  ).toBeVisible()
  await expect(page.locator('article[lang="hi"]')).toBeVisible()
  await expect(page.getByText(/भारतीय डेटा संरक्षण बोर्ड/)).toBeVisible()
})

test("a customer who hasn't accepted this notice is asked once", async ({
  page,
}) => {
  await signInWithOtp(page, "/account")
  await page.waitForURL(/\/account/)
  const { userId } = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session")
    const session = (await response.json()) as { user: { id: string } }
    return { userId: session.user.id }
  })
  // The sign-in recorded it; a later "no" stands in for an older account.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const before = await client.query(
    "select purpose from data_consents where user_id = $1 and notice_version = $2 order by purpose",
    [userId, NOTICE_VERSION],
  )
  expect(before.rows.map((row) => row.purpose)).toEqual(["account", "age"])
  await client.query(
    "insert into data_consents (user_id, purpose, granted, notice_version, source) values ($1, 'account', false, $2, 'e2e')",
    [userId, NOTICE_VERSION],
  )
  await client.end()

  await page.goto("/account/orders")
  await expect(page).toHaveURL(/\/privacy-consent\?next=/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Your privacy" }),
  ).toBeVisible()
  await page.waitForLoadState("networkidle")
  await tickConsent(page, "account")
  await tickConsent(page, "age")
  await page.getByRole("button", { name: "Agree and continue" }).click()
  await expect(page).toHaveURL(/\/account\/orders$/)
  // Asked once: straight in next time.
  await page.goto("/account")
  await expect(page).toHaveURL(/\/account$/)
})

test("a customer manages their consents, data and nominee", async ({
  page,
}) => {
  await signInWithOtp(page, "/account/privacy")
  await expect(page).toHaveURL(/\/account\/privacy$/)
  await expect(
    page.getByRole("heading", { name: "What you've agreed to" }),
  ).toBeVisible()
  await expect(page.getByText("Your account", { exact: true })).toBeVisible()

  const download = page.getByRole("link", { name: "Download my data" })
  const file = await page.request.get((await download.getAttribute("href"))!)
  expect(file.headers()["content-disposition"]).toContain("duis-my-data.json")
  expect((await file.json()).consents.length).toBeGreaterThan(0)

  await page.waitForLoadState("networkidle")
  await page.getByRole("textbox", { name: "Their name" }).fill("Asha Rao")
  await page
    .getByRole("textbox", { name: "Their email or phone number" })
    .fill("asha@duis.test")
  await tickConsent(page, "nominee")
  await page.getByRole("button", { name: "Save nominee" }).click()
  await expect(
    page.getByRole("button", { name: "Remove nominee" }),
  ).toBeVisible()
})

test("a customer asks for deletion and an admin completes it", async ({
  browser,
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  test.setTimeout(90_000)
  const shopper = await browser.newContext()
  const customer = await shopper.newPage()
  await signInWithOtp(customer, "/account/privacy")
  await expect(customer).toHaveURL(/\/account\/privacy$/)
  await customer.waitForLoadState("networkidle")
  await customer
    .getByRole("button", { name: "Request account deletion" })
    .click()
  await customer.getByRole("button", { name: "Yes, request deletion" }).click()
  await expect(customer.getByText(/You asked us to delete/)).toBeVisible()
  const { id } = (
    await (await customer.request.get("/api/auth/get-session")).json()
  ).user as { id: string }

  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)
  await page.goto("/admin/data-requests")
  await page.locator(`a[href="/admin/customers/${id}"]`).click()
  await page.waitForLoadState("networkidle")
  const erase = page.getByRole("button", {
    name: "Delete account and personal data",
  })
  await expect(erase).toBeDisabled()
  await page.getByLabel("Type DELETE to confirm").fill("DELETE")
  await erase.click()
  await expect(page.getByText(/Account deleted on/)).toBeVisible()
  await expect(
    page.getByRole("heading", { level: 1, name: "Deleted customer" }),
  ).toBeVisible()

  // Their session has ended.
  await customer.goto("/account")
  await expect(customer).toHaveURL(/\/login/)
  await shopper.close()
})

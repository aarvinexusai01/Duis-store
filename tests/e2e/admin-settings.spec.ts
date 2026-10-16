import { createHash, randomBytes } from "node:crypto"

import { expect, test } from "@playwright/test"
import pg from "pg"

import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

async function query(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}

test.describe.configure({ mode: "serial" })

test("super admin invites staff, who joins and is sent to 2FA; the audit log shows it", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const owner = await createStaff(page, "super_admin")
  await signInAndSetUpTwoFactor(page, owner)

  // Ctrl/⌘+K jumps to a page by name.
  await page.keyboard.press("ControlOrMeta+k")
  await page.getByRole("combobox").fill("Staff")
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("heading", { level: 1, name: "Staff" }),
  ).toBeVisible()
  await page.waitForLoadState("networkidle")

  const email = `e2e-invite-${Date.now()}@duis.test`
  await page.getByLabel("Email").fill(email)
  await page.getByLabel(/Support Agent/).check()
  await page.getByRole("button", { name: "Send invitation" }).click()
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible()

  // The real token is only in the email: give the invitation a known one.
  const token = randomBytes(32).toString("base64url")
  await query(
    "update staff_invitations set token_hash = $1 where email = $2 and accepted_at is null and revoked_at is null",
    [createHash("sha256").update(token).digest("hex"), email],
  )
  const invitee = await (await browser.newContext()).newPage()
  await invitee.goto(`/admin/join?token=${token}`)
  await invitee.waitForLoadState("networkidle")
  await expect(invitee.getByText(/invited as/)).toBeVisible()
  await invitee.getByLabel("Your name").fill("Riya Support")
  await invitee.getByLabel("Choose a password").fill("Support-Passw0rd!")
  await invitee.getByRole("button", { name: "Create account" }).click()
  await invitee.waitForURL("**/admin/two-factor")
  await expect(
    invitee.getByRole("heading", { name: "Secure your staff account" }),
  ).toBeVisible()

  await page.goto("/admin/audit?action=staff.")
  await expect(page.getByText("staff.accept_invitation").first()).toBeVisible()
  await expect(page.getByText("staff.invite").first()).toBeVisible()
})

test("settings save and reports download", async ({ page, isMobile }) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)
  const before = await query(
    "select free_shipping_threshold_paise from store_settings where id = 1",
  )
  try {
    await page.goto("/admin/settings")
    await page.waitForLoadState("networkidle")
    const shipping = page.locator("#shipping")
    await shipping.getByLabel(/Free shipping in India from/).fill("1299")
    await shipping.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Shipping saved")).toBeVisible()
    const after = await query(
      "select free_shipping_threshold_paise from store_settings where id = 1",
    )
    expect(after.rows[0].free_shipping_threshold_paise).toBe(129_900)
  } finally {
    await query(
      "update store_settings set free_shipping_threshold_paise = $1 where id = 1",
      [before.rows[0].free_shipping_threshold_paise],
    )
  }

  await page.goto("/admin/reports")
  await expect(
    page.getByRole("heading", { level: 1, name: "Reports" }),
  ).toBeVisible()
  const download = await page.request.get(
    (await page.getByRole("link", { name: "GST CSV" }).getAttribute("href"))!,
  )
  expect(download.headers()["content-type"]).toContain("text/csv")
  expect(await download.text()).toContain("order_number,order_date")
})

test("content editor is refused on settings, staff, reports and orders", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const editor = await createStaff(page, "content_editor")
  await signInAndSetUpTwoFactor(page, editor)
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0)
  for (const path of [
    "/admin/settings",
    "/admin/staff",
    "/admin/reports",
    "/admin/orders",
    "/admin/system",
  ]) {
    await page.goto(path)
    await expect(
      page.getByText("You don't have access to this page."),
    ).toBeVisible()
  }
  const csv = await page.request.get("/admin/export/orders")
  expect(csv.status()).toBe(404)
})

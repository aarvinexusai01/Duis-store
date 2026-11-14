import { expect, test } from "@playwright/test"
import pg from "pg"

import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

const cat = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Help from Miso/ })

test("first visit: the helper's tour runs once, can be skipped, and doesn't come back", async ({
  page,
}) => {
  await page.goto("/")
  const admin = await createStaff(page, "store_admin", { tour: true })
  await signInAndSetUpTwoFactor(page, admin)

  const tour = page.getByRole("dialog", { name: "Hi, I'm Miso!" })
  await expect(tour).toBeVisible()
  await tour.getByRole("button", { name: "Next" }).click()
  await expect(page.getByRole("dialog", { name: "The menu" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // Skipping is saved to the account, so a reload doesn't start it again.
  await page.waitForLoadState("networkidle")
  await page.reload()
  await expect(cat(page)).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // It can be replayed from the helper.
  await cat(page).click()
  await page.getByRole("button", { name: "Show me around" }).click()
  await expect(
    page.getByRole("dialog", { name: "Hi, I'm Miso!" }),
  ).toBeVisible()
})

test("the helper shows tips for the page and a checklist, and hiding it is remembered", async ({
  page,
}) => {
  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)

  await cat(page).click()
  await expect(
    page.getByText("This is the last 30 days at a glance."),
  ).toBeVisible()
  await page.getByRole("tab", { name: /Getting started/ }).click()
  await expect(page.getByRole("link", { name: /Add a product/ })).toBeVisible()
  // A store admin doesn't write journal stories, so that step isn't listed.
  await expect(page.getByRole("link", { name: /journal story/ })).toHaveCount(0)

  // Tips follow the page.
  await page.keyboard.press("Escape")
  await page.goto("/admin/inventory")
  await cat(page).click()
  await expect(page.getByText(/Received new stock/).first()).toBeVisible()

  await page.getByRole("button", { name: "Hide helper" }).click()
  await expect(cat(page)).toHaveCount(0)
  await page.waitForLoadState("networkidle")
  await page.reload()
  await expect(
    page.getByRole("button", { name: /Show the helper/ }),
  ).toBeVisible()
  await expect(cat(page)).toHaveCount(0)

  await page.getByRole("button", { name: /Show the helper/ }).click()
  await expect(cat(page)).toBeVisible()
})

test("the helper cheers when something is saved", async ({ page }) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const { rows } = await client.query<{ id: string }>(
    "select id from products order by created_at limit 1",
  )
  await client.end()
  test.skip(!rows[0], "no seeded catalogue")

  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)
  await page.goto(`/admin/products/${rows[0]!.id}`)
  await page.waitForLoadState("networkidle")

  // Saving without changes still saves, and shows the usual message.
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Product saved")).toBeVisible()
  await expect(cat(page)).toHaveAttribute(
    "data-mood",
    /sparkle|delighted|heart/,
  )
})

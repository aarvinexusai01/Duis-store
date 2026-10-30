import { expect, test } from "@playwright/test"
import pg from "pg"

import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

test.describe.configure({ mode: "serial" })

test("store admin: 2FA, create a product, generate variants, receive stock", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)

  await page.goto("/admin/products/new")
  await page.waitForLoadState("networkidle")
  const title = `E2E Tee ${Date.now()}`
  await page.getByLabel("Title", { exact: true }).fill(title)
  await page
    .getByLabel("Manufacturer / packer")
    .fill("Duis Apparel, Lucknow, India")
  // First category in the tree, and Colour + Size as options.
  await page
    .getByRole("group", { name: "Categories" })
    .getByRole("checkbox")
    .first()
    .check()
  await page.getByLabel("Colour").check()
  await page.getByLabel("Size", { exact: true }).check()
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/)
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible()

  await page.getByRole("tab", { name: "Variants & stock" }).click()
  const generator = page.locator("form:has(h3:text('Generate variants'))")
  await generator
    .getByRole("group", { name: "Colour" })
    .getByRole("checkbox")
    .first()
    .check()
  await generator
    .getByRole("group", { name: "Size" })
    .getByRole("checkbox")
    .nth(1)
    .check()
  await generator.getByLabel("Price ₹").fill("799")
  await generator.getByLabel("MRP ₹").fill("999")
  await generator.getByLabel("Starting stock each").fill("5")
  await generator
    .getByRole("button", { name: /Create up to 1 variants/ })
    .click()
  await expect(
    page.getByRole("button", { name: "Stock" }).first(),
  ).toBeVisible()

  await page.getByRole("button", { name: "Stock" }).first().click()
  await page.getByRole("dialog").getByLabel("Quantity").fill("3")
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Stock updated")).toBeVisible()

  await page.goto("/admin/inventory/movements")
  await expect(page.getByRole("cell", { name: title }).first()).toBeVisible()
})

test("content editor sees no catalogue editing and no inventory", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const editor = await createStaff(page, "content_editor")
  await signInAndSetUpTwoFactor(page, editor)
  await expect(page.getByRole("link", { name: "Inventory" })).toHaveCount(0)
  await page.goto("/admin/products")
  await expect(page.getByRole("link", { name: "New product" })).toHaveCount(0)
  await page.goto("/admin/inventory")
  await expect(
    page.getByText("You don't have access to this page."),
  ).toBeVisible()
})

test("product editor: saves twice in a row, and refuses a save from a stale tab", async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const { rows } = await client.query<{ id: string; title: string }>(
    "select id, title from products where status = 'active' order by created_at limit 1",
  )
  await client.end()
  test.skip(!rows[0], "no seeded catalogue")
  const product = rows[0]!

  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)

  const open = async (tab: typeof page) => {
    await tab.goto(`/admin/products/${product.id}`)
    await tab.waitForLoadState("networkidle")
  }
  const save = async (tab: typeof page, title: string) => {
    await tab.getByLabel("Title", { exact: true }).fill(title)
    await tab.getByRole("button", { name: "Save changes" }).click()
  }

  // A second tab opens the product before the first one saves.
  const stale = await context.newPage()
  await open(stale)
  await open(page)

  // Two saves in a row from one tab: the form keeps the new version.
  await save(page, `${product.title} (edited)`)
  await expect(page.getByText("Product saved")).toBeVisible()
  await save(page, product.title)
  await expect(page.getByText("Product saved").last()).toBeVisible()

  // The stale tab is told to reload instead of overwriting the edits.
  await save(stale, `${product.title} (stale)`)
  await expect(
    stale.getByText(/Someone else saved this product after you opened it/),
  ).toBeVisible()
  await stale.close()
})

test("leaving the admin for the store hides the scrollbars again", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const admin = await createStaff(page, "content_editor")
  await signInAndSetUpTwoFactor(page, admin)
  await page.goto("/admin")
  const scrollbars = () =>
    page.evaluate(
      () => getComputedStyle(document.documentElement).scrollbarWidth,
    )
  await expect.poll(scrollbars).toBe("auto")
  // A client-side navigation: the admin tree can stay in the document,
  // hidden, so the store must not take it as "this is the admin".
  await page.getByRole("link", { name: "View store" }).click()
  await page.waitForURL((url) => url.pathname === "/")
  await expect.poll(scrollbars).toBe("none")
  await page.goBack()
  await page.waitForURL(/\/admin/)
  await expect.poll(scrollbars).toBe("auto")
})

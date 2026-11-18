import { expect, test, type Page } from "@playwright/test"
import pg from "pg"

import { makeUniqueImage } from "../helpers/images"
import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

const cat = (page: Page) =>
  page.getByRole("button", { name: /^Help from Miso/ })
const says = (page: Page) => page.getByRole("dialog", { name: "Miso says" })
/**
 * The helper saves settings with a server action (a POST to the page); `sent`
 * picks it out from the to-do refresh that also runs on navigation.
 */
const saved = (page: Page, sent?: string) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      !!response.request().headers()["next-action"] &&
      (!sent || (response.request().postData() ?? "").includes(sent)),
  )

async function query<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    return (await client.query<T>(text, values)).rows
  } finally {
    await client.end()
  }
}

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
  const skipped = saved(page)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // Skipping is saved to the account, so a reload doesn't start it again.
  await skipped
  await page.reload()
  await expect(cat(page)).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // It can be replayed from the helper.
  await cat(page).click()
  await page.getByRole("button", { name: "Welcome tour" }).click()
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
  await page.getByRole("tab", { name: "This page" }).click()
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
  await page.getByRole("tab", { name: "This page" }).click()
  await expect(page.getByText(/Received new stock/).first()).toBeVisible()

  const hid = saved(page, "true")
  await page.getByRole("button", { name: "Hide helper" }).click()
  await expect(cat(page)).toHaveCount(0)
  await hid
  await page.reload()
  await expect(
    page.getByRole("button", { name: /Show the helper/ }),
  ).toBeVisible()
  await expect(cat(page)).toHaveCount(0)

  await page.getByRole("button", { name: /Show the helper/ }).click()
  await expect(cat(page)).toBeVisible()
})

test("the helper cheers when something is saved", async ({ page }) => {
  const rows = await query<{ id: string }>(
    "select id from products order by created_at limit 1",
  )
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

test("product walkthrough: the helper guides a new product from its name to the shop", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const admin = await createStaff(page, "store_admin", { guides: true })
  await signInAndSetUpTwoFactor(page, admin)

  await page.goto("/admin/products/new")
  await page.waitForLoadState("networkidle")
  await expect(says(page)).toContainText("walk you through")
  await says(page).getByRole("button", { name: "Walk me through" }).click()

  const step = (name: string) => page.getByRole("dialog", { name })
  const next = (name: string) =>
    step(name)
      .getByRole("button", { name: /^(Next|Finish)$/ })
      .click()
  await expect(step("Before you start")).toBeVisible()
  await next("Before you start")
  await expect(step("Name it")).toBeVisible()
  const title = `E2E Walkthrough Hoodie ${Date.now()}`
  await page.getByLabel("Title", { exact: true }).fill(title)
  await page.getByLabel("Title", { exact: true }).press("Tab")
  // Each step moves on by itself once it's done.
  await expect(step("Pick its category")).toBeVisible()
  await page
    .getByRole("group", { name: "Categories" })
    .getByRole("checkbox")
    .first()
    .check()
  await expect(step("Colour, then Size")).toBeVisible()
  // By role: the helper's bubble mentions Colour too.
  await page.getByRole("checkbox", { name: "Colour", exact: true }).check()
  await page.getByRole("checkbox", { name: "Size", exact: true }).check()
  await expect(step("Describe it")).toBeVisible()
  await next("Describe it")
  await next("Packed weight")
  await expect(step("Create it")).toBeVisible()
  await page
    .getByLabel("Manufacturer / packer")
    .fill("Duis Apparel, Lucknow, India")
  await page.getByRole("button", { name: "Create product" }).click()
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/)

  // The health check lists what's missing before it can be published.
  const health = page.getByRole("region", { name: /Ready to sell/ })
  await expect(health).toContainText("No photos yet")
  await expect(health).toContainText("Must fix")

  // Sizes and stock first, so the photos can be tagged by colour.
  await expect(step("Sizes and colours")).toBeVisible()
  await page.getByRole("tab", { name: "Variants & stock" }).click()
  await expect(step("Generate variants")).toBeVisible()
  const generator = page.locator("form:has(h3:text('Generate variants'))")
  await generator
    .getByRole("group", { name: "Colour", exact: true })
    .getByRole("checkbox")
    .first()
    .check()
  await generator
    .getByRole("group", { name: "Size", exact: true })
    .getByRole("checkbox")
    .first()
    .check()
  await generator.getByLabel("Price ₹").fill("1499")
  await generator.getByLabel("MRP ₹").fill("1999")
  await generator.getByLabel("Starting stock each").fill("4")
  // Unique per run: the default (from the name) is the same every run.
  await generator.getByLabel("SKU prefix").fill(`E2EW-${Date.now() % 1e8}`)
  await generator
    .getByRole("button", { name: /Create up to \d+ variants/ })
    .click()
  await expect(step("Check the stock")).toBeVisible()
  await next("Check the stock")

  await expect(step("Photos next")).toBeVisible()
  await page.getByRole("tab", { name: "Photos" }).click()
  await expect(step("Upload photos")).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.locator("#media-upload").setInputFiles({
    name: `walkthrough-${Date.now()}.png`,
    mimeType: "image/png",
    buffer: await makeUniqueImage(800, 1000),
  })
  await expect(step("Tag the colours")).toBeVisible({ timeout: 20_000 })
  // The photo can be tagged with the colour just generated.
  await page
    .locator('[data-tour="media-colour"] select')
    .first()
    .selectOption({ index: 1 })
  await next("Tag the colours")
  await expect(step("Save the photos")).toBeVisible()
  await page.getByRole("button", { name: "Save photos" }).click()
  await expect(health).not.toContainText("Must fix")

  await expect(step("Ready to sell?")).toBeVisible()
  await next("Ready to sell?")
  await expect(step("Publish")).toBeVisible()
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(step("See it in the shop")).toBeVisible()
  await expect(
    page.getByRole("link", { name: "View in store" }),
  ).toHaveAttribute("href", /^\/products\//)
  await next("See it in the shop")
  await expect(step("Put it in a collection")).toBeVisible()
  await next("Put it in a collection")
  await expect(says(page)).toContainText("ready to sell")

  const [row] = await query<{ status: string; tagged: number; seen: string[] }>(
    `select p.status::text,
       (select count(*)::int from product_media pm
        where pm.product_id = p.id and pm.color_value_id is not null) as tagged,
       sp.seen_guides as seen
     from products p, staff_preferences sp
     join users u on u.id = sp.user_id
     where p.title = $1 and u.email = $2`,
    [title, admin.email],
  )
  expect(row).toEqual({
    status: "active",
    tagged: 1,
    seen: expect.arrayContaining(["product-walkthrough"]),
  })
})

test("the written guide opens from Products, and starts the walkthrough", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)

  await page.goto("/admin/products")
  await page.getByRole("link", { name: "How to add a product" }).click()
  await expect(
    page.getByRole("heading", { level: 1, name: "How to add a product" }),
  ).toBeVisible()
  for (const heading of [
    "1. Before your first product",
    "3. Sizes, prices and stock",
    "4. Photos",
    "6. After publishing",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name: heading }),
    ).toBeVisible()
  }
  await page.getByRole("link", { name: "Open Size charts →" }).click()
  await expect(page).toHaveURL(/\/admin\/size-charts$/)
  await page.goBack()

  await page.getByRole("button", { name: "Start the walkthrough" }).click()
  await page.waitForURL(/\/admin\/products\/new$/)
  await expect(
    page.getByRole("dialog", { name: "Before you start" }),
  ).toBeVisible()
})

test("the dashboard and the cat show today's to-do list", async ({ page }) => {
  // A new message from the contact form needs answering.
  const [message] = await query<{ id: string }>(
    `insert into contact_messages (name, email, topic, message)
     values ('E2E To-do', 'e2e-todo@duis.test', 'other', 'Where is my parcel?')
     returning id`,
  )
  try {
    await page.goto("/")
    const admin = await createStaff(page, "super_admin")
    await signInAndSetUpTwoFactor(page, admin)

    const today = page.getByRole("region", { name: "Today, from Miso" })
    await expect(
      today.getByRole("link", { name: /new customer messages?$/ }),
    ).toBeVisible()
    await expect(page.getByTestId("helper-badge")).toBeVisible()
    await expect(cat(page)).toHaveAccessibleName(/to do today/)

    await cat(page).click()
    await expect(page.getByRole("tab", { name: /^Today/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /new customer messages?$/ })
      .click()
    await expect(page).toHaveURL(/\/admin\/messages$/)
  } finally {
    await query("update contact_messages set status = 'closed' where id = $1", [
      message!.id,
    ])
  }
})

test("a page tour is offered once, on the first visit to each page", async ({
  page,
}) => {
  await page.goto("/")
  const admin = await createStaff(page, "store_admin", { guides: true })
  await signInAndSetUpTwoFactor(page, admin)

  await page.goto("/admin/customers")
  await page.waitForLoadState("networkidle")
  await expect(says(page)).toContainText("First time on Customers?")
  const started = saved(page, "page:/admin/customers")
  await says(page).getByRole("button", { name: "Show me" }).click()
  await expect(page.getByRole("dialog", { name: "Customers" })).toBeVisible()
  for (let i = 0; i < 6; i++) {
    const done = page.getByRole("button", { name: "Done" })
    if (await done.isVisible()) break
    await page.getByRole("button", { name: "Next" }).click()
  }
  await page.getByRole("button", { name: "Done" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // Seen: not offered again, even after a reload.
  await started
  await page.reload()
  await expect(cat(page)).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(says(page)).toHaveCount(0)

  // Declined on another page: not offered again either, but can be replayed.
  await page.goto("/admin/orders")
  await expect(says(page)).toContainText("First time on Orders?")
  const declined = saved(page, "page:/admin/orders")
  await says(page).getByRole("button", { name: "Not now" }).click()
  await declined
  await page.reload()
  await expect(cat(page)).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(says(page)).toHaveCount(0)
  await cat(page).click()
  await page.getByRole("button", { name: "Tour this page" }).click()
  await expect(page.getByRole("dialog", { name: "Orders" })).toBeVisible()
})

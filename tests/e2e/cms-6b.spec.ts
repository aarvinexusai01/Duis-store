import { expect, test, type Page } from "@playwright/test"

import { makeUniqueImage } from "../helpers/images"
import { removeTestPages } from "./support/cms"
import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

/** Phase 6b: menus, redirects and the media library, as staff use them. */
const SECOND_REPLICA = `http://localhost:${process.env.E2E_SECOND_PORT ?? 3102}`

const created: string[] = []
test.afterEach(async () => {
  for (const slug of created.splice(0)) await removeTestPages(slug)
})

async function signInAsManager(page: Page) {
  const manager = await createStaff(page, "content_manager")
  await signInAndSetUpTwoFactor(page, manager)
}

async function saved(page: Page) {
  await expect(page.getByText(/^Saved /)).toBeVisible()
}

async function publish(page: Page) {
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("Published: live within seconds")).toBeVisible()
}

/** Whether both replicas' home page does (or doesn't) contain `text` within 10 s. */
async function homeOnBoth(page: Page, text: string, present: boolean) {
  const started = Date.now()
  for (const base of [new URL(page.url()).origin, SECOND_REPLICA]) {
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`${base}/`)
          return (await response.text()).includes(text)
        },
        {
          timeout: Math.max(1, 10_000 - (Date.now() - started)),
          intervals: [250],
        },
      )
      .toBe(present)
  }
}

test("a footer menu change reaches both replicas", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  test.setTimeout(90_000)
  await signInAsManager(page)
  await page.goto("/admin/cms/navigation/footer")
  const label = `E2E ${Date.now() % 1_000_000}`

  await page.getByRole("button", { name: "Add item" }).last().click()
  const item = page.getByTestId("nav-item").last()
  await item.getByRole("button", { name: /^New link/ }).click()
  await item.getByRole("textbox", { name: "Label" }).fill(label)
  await saved(page)
  await publish(page)
  await homeOnBoth(page, label, true)

  // Put the menu back as it was.
  page.once("dialog", (dialog) => dialog.accept())
  await item.getByRole("button", { name: `Delete ${label}` }).click()
  await saved(page)
  await publish(page)
  await homeOnBoth(page, label, false)
})

test("a page's old address redirects to the new one", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  test.setTimeout(120_000)
  await signInAsManager(page)
  const stamp = Date.now()
  await page.goto("/admin/cms")
  await page.getByRole("button", { name: "New page" }).click()
  const dialog = page.getByRole("dialog", { name: "New page" })
  await dialog.getByRole("textbox", { name: "Name" }).fill(`E2E Move ${stamp}`)
  await dialog.getByRole("button", { name: "Create page" }).click()
  const oldSlug = `e2e-move-${stamp}`
  const newSlug = `e2e-moved-${stamp}`
  created.push(oldSlug, newSlug)

  await page
    .getByRole("combobox", { name: "Add a section" })
    .selectOption("announcement")
  await saved(page)
  await publish(page)

  page.once("dialog", (prompt) => prompt.accept(newSlug))
  await page.getByRole("button", { name: "Change address" }).click()
  await expect(page.getByText("Address changed")).toBeVisible()

  // Each replica reloads its redirect list within 30 seconds.
  for (const base of [new URL(page.url()).origin, SECOND_REPLICA]) {
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${base}/pages/${oldSlug}?ref=x`,
            {
              maxRedirects: 0,
            },
          )
          return `${response.status()} ${response.headers().location ?? ""}`
        },
        { timeout: 40_000, intervals: [1_000] },
      )
      .toMatch(new RegExp(`^301 .*/pages/${newSlug}\\?ref=x$`))
  }
})

test("the media library uploads, describes and deletes an image", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  test.setTimeout(90_000)
  await signInAsManager(page)
  await page.goto("/admin/media")
  // The file input only reacts once the page has hydrated.
  await page.waitForLoadState("networkidle")
  const name = `e2e-${Date.now()}.png`
  await page.locator("#media-upload-many").setInputFiles({
    name,
    mimeType: "image/png",
    buffer: await makeUniqueImage(800, 1000),
  })
  await expect(page.getByText("1 image uploaded")).toBeVisible()

  await page.goto(`/admin/media?view=list&q=${encodeURIComponent(name)}`)
  await page.getByRole("button", { name: new RegExp(name) }).click()
  const details = page.getByRole("dialog", { name: "Image details" })
  await expect(details.getByText("Not used anywhere.")).toBeVisible()
  await details
    .getByRole("textbox", { name: "Alt text" })
    .fill("E2E test image")
  await details.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Saved")).toBeVisible()

  await page.getByRole("button", { name: /E2E test image/ }).click()
  page.once("dialog", (confirm) => confirm.accept())
  await page
    .getByRole("dialog", { name: "Image details" })
    .getByRole("button", { name: "Delete image" })
    .click()
  await expect(page.getByText("Deleted")).toBeVisible()
})

import { expect, test, type Page } from "@playwright/test"

import { removeTestPages } from "./support/cms"
import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

/**
 * The CMS Definition of Done (doc/06 Phase 6): a published change is live on
 * both web replicas within 10 seconds, with no rebuild. The config starts a
 * second replica and a worker that only clears caches.
 */
const SECOND_REPLICA = `http://localhost:${process.env.E2E_SECOND_PORT ?? 3102}`

// Each test deletes only its own page: afterAll runs once per worker, so a
// shared prefix would delete pages another test is still checking.
const created: string[] = []
test.afterEach(async () => {
  for (const slug of created.splice(0)) await removeTestPages(slug)
})

async function newLandingPage(page: Page, title: string) {
  await page.goto("/admin/cms")
  await page.getByRole("button", { name: "New page" }).click()
  const dialog = page.getByRole("dialog", { name: "New page" })
  await dialog.getByRole("textbox", { name: "Name" }).fill(title)
  await dialog.getByRole("button", { name: "Create page" }).click()
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible()
  const address = (await page
    .getByText(/^\/pages\//)
    .first()
    .textContent())!
  created.push(address.replace("/pages/", ""))
  return address
}

async function addAnnouncement(page: Page, text: string) {
  await page
    .getByRole("combobox", { name: "Add a section" })
    .selectOption("announcement")
  const section = page.getByTestId("cms-section").last()
  await section.getByRole("textbox", { name: "Text" }).fill(text)
  await expect(page.getByText(/^Saved /)).toBeVisible()
}

/** Both replicas serve `text` at `path` within 10 seconds of publishing. */
async function liveOnBoth(page: Page, path: string, text: string) {
  const started = Date.now()
  for (const base of [new URL(page.url()).origin, SECOND_REPLICA]) {
    let last = "no response yet"
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`${base}${path}`)
          const body = await response.text()
          last = `HTTP ${response.status()}, ${body.includes(text) ? "has" : "lacks"} the text`
          return response.ok() && body.includes(text)
        },
        {
          timeout: Math.max(1, 10_000 - (Date.now() - started)),
          intervals: [250],
          message: `${base}${path} (last: ${last})`,
        },
      )
      .toBe(true)
  }
}

test("a manager publishes and both replicas update within 10 seconds", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  test.setTimeout(90_000)
  const manager = await createStaff(page, "content_manager")
  await signInAndSetUpTwoFactor(page, manager)

  const title = `E2E Drop ${Date.now()}`
  const address = await newLandingPage(page, title)
  await addAnnouncement(page, "First words")
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("Published: live within seconds")).toBeVisible()
  await liveOnBoth(page, address, "First words")

  // An edit to a page that is already cached on both replicas.
  const section = page.getByTestId("cms-section").last()
  if (!(await section.getByRole("textbox", { name: "Text" }).isVisible()))
    await section
      .getByRole("button", { name: "Announcement First words", exact: true })
      .click()
  await section.getByRole("textbox", { name: "Text" }).fill("Second words")
  await expect(page.getByText(/^Saved /)).toBeVisible()
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("Published: live within seconds")).toBeVisible()
  await liveOnBoth(page, address, "Second words")

  // History shows both versions; then tidy up.
  await page.getByRole("tab", { name: /History/ }).click()
  await expect(page.getByText("Version 2")).toBeVisible()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Archive" }).click()
  await expect(
    page.getByText("Archived", { exact: true }).first(),
  ).toBeVisible()
})

test("an editor can submit for review but not publish", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  test.setTimeout(90_000)
  const editor = await createStaff(page, "content_editor")
  await signInAndSetUpTwoFactor(page, editor)

  await newLandingPage(page, `E2E Draft ${Date.now()}`)
  await addAnnouncement(page, "Please check")
  await expect(
    page.getByRole("button", { name: "Publish", exact: true }),
  ).toHaveCount(0)
  await page.getByRole("button", { name: "Submit for review" }).click()
  const dialog = page.getByRole("dialog", { name: "Submit for review" })
  await dialog.getByRole("button", { name: "Submit" }).click()
  await expect(page.getByText("Waiting for review").first()).toBeVisible()
  // Locked while it waits.
  await expect(page.getByText(/locked while it waits/)).toBeVisible()
})

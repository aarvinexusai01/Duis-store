import { expect, test, type Page } from "@playwright/test"

import { removeTestStory } from "./support/cms"
import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

/**
 * The Journal (doc/06 Phase 6c): a story published in the admin is on
 * /journal and in the RSS feed on both replicas within 10 seconds, and a
 * YouTube block loads nothing from YouTube until it's played.
 */
const SECOND_REPLICA = `http://localhost:${process.env.E2E_SECOND_PORT ?? 3102}`
const YOUTUBE = /youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com/

const cleanup: { slug: string; author: string }[] = []
test.afterEach(async () => {
  for (const { slug, author } of cleanup.splice(0))
    await removeTestStory(slug, author)
})

async function onBoth(page: Page, path: string, text: string) {
  const started = Date.now()
  for (const base of [new URL(page.url()).origin, SECOND_REPLICA]) {
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${base}${path}`)).text()).includes(
            text,
          ),
        {
          timeout: Math.max(1, 10_000 - (Date.now() - started)),
          intervals: [250],
        },
      )
      .toBe(true)
  }
}

test("a published story reaches the Journal and RSS on both replicas", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  test.setTimeout(120_000)
  const manager = await createStaff(page, "content_manager")
  await signInAndSetUpTwoFactor(page, manager)
  const stamp = Date.now()
  const author = `E2E Writer ${stamp}`
  const title = `E2E Story ${stamp}`
  cleanup.push({ slug: `e2e-story-${stamp}`, author: `e2e-writer-${stamp}` })

  await page.goto("/admin/cms/journal/settings")
  await page.getByRole("textbox", { name: "Author name" }).last().fill(author)
  await page.getByRole("button", { name: "Add author" }).click()
  await expect(page.getByText("Author added")).toBeVisible()

  await page.goto("/admin/cms/journal")
  await page.getByRole("button", { name: "New story" }).click()
  const dialog = page.getByRole("dialog", { name: "New story" })
  await dialog.getByRole("textbox", { name: "Title" }).fill(title)
  await dialog
    .getByRole("combobox", { name: "Author" })
    .selectOption({ label: author })
  await dialog.getByRole("button", { name: "Create story" }).click()
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible()

  await page
    .getByRole("combobox", { name: "Add a block" })
    .selectOption("youtube")
  await page
    .getByRole("textbox", { name: "YouTube link" })
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  await page
    .getByRole("textbox", { name: "Excerpt (shown in lists and feeds)" })
    .fill("Rain-proof layers for the monsoon.")
  await expect(page.getByText(/^Saved /)).toBeVisible()
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("Published: live within seconds")).toBeVisible()

  await onBoth(page, "/journal", title)
  await onBoth(page, "/journal/rss.xml", title)

  // The video loads nothing from YouTube until play is pressed.
  const reader = await (await page.context().browser()!.newContext()).newPage()
  const seen: string[] = []
  reader.on("request", (request) => {
    if (YOUTUBE.test(request.url())) seen.push(request.url())
  })
  await reader.route(YOUTUBE, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "" }),
  )
  await reader.goto(`/journal/e2e-story-${stamp}`)
  await expect(
    reader.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible()
  await reader.waitForLoadState("networkidle")
  expect(seen).toEqual([])
  await reader.getByRole("button", { name: /Play video/ }).click()
  await expect
    .poll(() =>
      seen.some((url) =>
        url.includes("youtube-nocookie.com/embed/dQw4w9WgXcQ"),
      ),
    )
    .toBe(true)
  await reader.close()
})

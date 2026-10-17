import { expect, test, type Page } from "@playwright/test"

import { inStockSlug } from "./support/shop"

/**
 * Exit criterion (doc/06 Phase 5): no analytics or Pixel requests before
 * consent. Every request to Google or Meta is recorded and answered locally,
 * so nothing leaves the test machine.
 */
const TRACKERS =
  /googletagmanager\.com|google-analytics\.com|doubleclick\.net|connect\.facebook\.net|facebook\.com\/tr/

// Start as a first-time visitor (the config pre-answers for other specs).
test.use({ storageState: { cookies: [], origins: [] } })

async function watchTrackers(page: Page): Promise<Set<string>> {
  const seen = new Set<string>()
  page.on("request", (request) => {
    if (TRACKERS.test(request.url())) seen.add(request.url())
  })
  await page.route(TRACKERS, (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  )
  return seen
}

const loaded = (seen: Set<string>, part: string) =>
  [...seen].some((url) => url.includes(part))

async function browse(page: Page) {
  await page.goto("/")
  const slug = await inStockSlug()
  if (slug) await page.goto(`/products/${slug}`)
  await page.waitForLoadState("networkidle")
}

test("nothing goes to Google or Meta until the visitor accepts", async ({
  page,
}) => {
  const seen = await watchTrackers(page)
  await browse(page)
  const banner = page.getByRole("dialog", { name: "Cookies" })
  await expect(banner).toBeVisible()
  for (const name of ["Reject all", "Choose", "Accept all"]) {
    await expect(banner.getByRole("button", { name })).toBeVisible()
  }
  expect([...seen]).toEqual([])
  const names = (await page.context().cookies()).map((c) => c.name)
  expect(names.filter((n) => /^(_ga|_fbp|_fbc|duis_consent)/.test(n))).toEqual(
    [],
  )

  await banner.getByRole("button", { name: "Accept all" }).click()
  await expect(banner).toBeHidden()
  await expect
    .poll(() => loaded(seen, "googletagmanager.com/gtag/js"))
    .toBe(true)
  await expect.poll(() => loaded(seen, "connect.facebook.net")).toBe(true)
  const consent = (await page.context().cookies()).find(
    (c) => c.name === "duis_consent",
  )
  expect(consent?.value).toMatch(/^1\.11\./)
})

test("Reject all keeps them off, and Cookie settings can change it", async ({
  page,
}) => {
  const seen = await watchTrackers(page)
  await browse(page)
  const banner = page.getByRole("dialog", { name: "Cookies" })
  await banner.getByRole("button", { name: "Reject all" }).click()
  await expect(banner).toBeHidden()

  await page.goto("/contact")
  await page.reload()
  await page.waitForLoadState("networkidle")
  await expect(banner).toBeHidden()
  expect([...seen]).toEqual([])

  // Analytics only, from the footer link.
  await page.getByRole("button", { name: "Cookie settings" }).click()
  await expect(banner).toBeVisible()
  await banner.getByRole("switch", { name: /Analytics/ }).click()
  await banner.getByRole("button", { name: "Save choices" }).click()
  await expect(banner).toBeHidden()
  await expect
    .poll(() => loaded(seen, "googletagmanager.com/gtag/js"))
    .toBe(true)
  expect(loaded(seen, "connect.facebook.net")).toBe(false)
})

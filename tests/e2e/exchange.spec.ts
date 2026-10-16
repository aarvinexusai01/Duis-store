import { expect, test, type Page } from "@playwright/test"

import { placePrepaidOrder } from "./support/shop"
import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

async function deliver(admin: Page, orderNumber: string) {
  await admin.goto(`/admin/orders/${orderNumber}`)
  await admin.waitForLoadState("networkidle")
  await admin.getByRole("button", { name: "Book parcel" }).click()
  await admin
    .getByRole("dialog")
    .getByRole("button", { name: "Book parcel" })
    .click()
  await expect(admin.getByText("Parcel booked", { exact: true })).toBeVisible()
  for (const next of [
    "Picked up",
    "In transit",
    "Out for delivery",
    "Delivered",
  ]) {
    await admin.getByRole("button", { name: "Next scan" }).click()
    await expect(admin.getByText(next).first()).toBeVisible()
  }
}

/**
 * Phase 5a, desktop: a delivered order is tracked, exchanged and reviewed;
 * staff approve the exchange and publish the review.
 */
test("delivered order: track, exchange, review; staff approve and publish", async ({
  browser,
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  // A long journey: checkout, staff 2FA, delivery, exchange and review.
  test.setTimeout(120_000)
  const shopper = await (await browser.newContext()).newPage()
  const orderNumber = await placePrepaidOrder(shopper, { variants: 2 })
  test.skip(!orderNumber, "no seeded catalogue")

  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)
  await deliver(page, orderNumber!)

  // The signed tracking link opens without signing in.
  await shopper.goto(`/account/orders/${orderNumber}`)
  const trackHref = await shopper
    .getByRole("link", { name: "Track parcel" })
    .getAttribute("href")
  const stranger = await (await browser.newContext()).newPage()
  await stranger.goto(trackHref!)
  await expect(stranger.getByText(/Your order: Delivered/)).toBeVisible()

  // Exchange for another size.
  await shopper.getByRole("link", { name: "Exchange an item" }).click()
  await expect(
    shopper.getByRole("heading", { name: "Request an exchange" }),
  ).toBeVisible()
  await shopper.waitForLoadState("networkidle")
  const option = shopper
    .locator('label:has(input[name="variant"]:not([disabled]))')
    .first()
  test.skip((await option.count()) === 0, "no other size in stock")
  await option.click()
  await shopper.getByRole("button", { name: "Request exchange" }).click()
  await expect(shopper.getByText(/Exchange EX-\d+ requested/)).toBeVisible()
  const exchangeNumber = (await shopper
    .getByText(/EX-\d{6}/)
    .first()
    .textContent())!.match(/EX-\d{6,}/)![0]

  await page.goto(`/admin/exchanges/${exchangeNumber}`)
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Approve" }).click()
  await expect(
    page.getByText("Approved", { exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.getByText(/Pickup booked|Awaiting payment/).first(),
  ).toBeVisible()

  // Review the item, then publish it.
  await shopper.goto(`/account/orders/${orderNumber}#reviews`)
  await shopper.waitForLoadState("networkidle")
  await shopper.getByRole("radio", { name: "5 stars" }).check({ force: true })
  await shopper
    .getByLabel("Your review")
    .fill("Heavy cotton, true to size, washes well.")
  await shopper.getByRole("button", { name: "Submit review" }).click()
  await expect(shopper.getByText("Thanks for your review!")).toBeVisible()

  await page.goto("/admin/reviews")
  await page.waitForLoadState("networkidle")
  await expect(
    page.getByText("Heavy cotton, true to size, washes well."),
  ).toBeVisible()
  await page
    .locator("li", { hasText: "Heavy cotton, true to size, washes well." })
    .first()
    .getByRole("button", { name: "Publish" })
    .click()
  await expect(
    page.getByText("Published", { exact: true }).first(),
  ).toBeVisible()
})

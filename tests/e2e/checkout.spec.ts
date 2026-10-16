import { expect, test } from "@playwright/test"

import { fillFirstAddress, inStockSlug, signInWithOtp } from "./support/shop"

test("checkout: address → pay (simulated) → confirmed → cancel", async ({
  page,
}) => {
  const slug = await inStockSlug()
  test.skip(!slug, "no seeded catalogue")
  await signInWithOtp(page, "/account")

  // Add the first in-stock size to the bag.
  await page.goto(`/products/${slug}`)
  await page.waitForLoadState("networkidle")
  const size = page.locator('input[name="axis-size"]:not([disabled])').first()
  await size.check({ force: true })
  await page.getByRole("button", { name: "Add to bag" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()

  await page.goto("/checkout")
  await expect(
    page.getByRole("heading", { level: 1, name: "Checkout" }),
  ).toBeVisible()
  // First order: add a delivery address.
  await fillFirstAddress(page)

  // Below ₹999 the courier rate is shown; GST is included.
  await expect(page.getByText("Prices include GST")).toBeVisible()
  const place = page.getByRole("button", { name: /Place order & pay/ })
  await expect(place).toBeEnabled()
  await place.click()
  await expect(
    page.getByRole("dialog", { name: "Simulated payment" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Pay successfully" }).click()

  await expect(
    page.getByRole("heading", { name: "Order confirmed" }),
  ).toBeVisible()
  const orderNumber = (await page
    .getByText(/DUIS-\d{6}/)
    .first()
    .textContent())!.match(/DUIS-\d{6,}/)![0]

  await page.goto(`/account/orders/${orderNumber}`)
  await expect(page.getByText(/Confirmed · Paid/)).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Cancel order" }).click()
  await page.getByRole("button", { name: "Yes, cancel order" }).click()
  await expect(page.getByText("This order was cancelled.")).toBeVisible()
})

import { expect, test } from "@playwright/test"

import { placePrepaidOrder } from "./support/shop"
import { createStaff, signInAndSetUpTwoFactor } from "./support/staff"

/**
 * The Administrator Definition of Done, step 4 (doc/01): receive an order,
 * book the parcel with AWB and label, and follow it to delivery, against the
 * fake courier.
 */
test("admin books a parcel and follows it to delivery", async ({
  browser,
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  // A long journey: checkout, staff 2FA, booking and every courier scan.
  test.setTimeout(120_000)
  const shopper = await browser.newContext()
  const customerPage = await shopper.newPage()
  const orderNumber = await placePrepaidOrder(customerPage)
  test.skip(!orderNumber, "no seeded catalogue")

  await page.goto("/")
  const admin = await createStaff(page, "store_admin")
  await signInAndSetUpTwoFactor(page, admin)

  await page.goto("/admin/orders?view=to_ship")
  await page.getByRole("link", { name: orderNumber! }).click()
  await expect(
    page.getByRole("heading", { level: 1, name: orderNumber! }),
  ).toBeVisible()
  await page.waitForLoadState("networkidle")

  await page.getByRole("button", { name: "Book parcel" }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Book parcel" })
    .click()
  await expect(page.getByText("Parcel booked", { exact: true })).toBeVisible()
  await expect(page.getByText("Ready to ship").first()).toBeVisible()
  const awb = (await page.getByText(/AWB FK\d{10}/).textContent())!.match(
    /FK\d{10}/,
  )![0]

  const label = page.getByRole("link", { name: "Label (PDF)" })
  const response = await page.request.get((await label.getAttribute("href"))!)
  expect(response.headers()["content-type"]).toBe("application/pdf")

  for (const next of ["Picked up", "In transit", "Out for delivery"]) {
    await page.getByRole("button", { name: "Next scan" }).click()
    await expect(page.getByText(next).first()).toBeVisible()
  }
  await page.getByRole("button", { name: "Next scan" }).click()
  await expect(
    page.locator("header, p").getByText("Delivered", { exact: true }).first(),
  ).toBeVisible()

  // The customer sees the courier and tracking number.
  await customerPage.goto(`/account/orders/${orderNumber}`)
  await expect(customerPage.getByText(awb)).toBeVisible()
  await shopper.close()
})

test("packing staff see orders without money and can't refund", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "admin flows are covered on desktop")
  await page.goto("/")
  const packer = await createStaff(page, "fulfilment_staff")
  await signInAndSetUpTwoFactor(page, packer)
  await page.goto("/admin/orders")
  await expect(
    page.getByRole("heading", { level: 1, name: "Orders" }),
  ).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Total" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "COD remittances" })).toHaveCount(
    0,
  )
  await expect(page.getByRole("link", { name: "Discounts" })).toHaveCount(0)
  await page.goto("/admin/orders/cod")
  await expect(
    page.getByText("You don't have access to this page."),
  ).toBeVisible()
})

import { expect, test } from "@playwright/test"
import pg from "pg"

import {
  chooseInStockSize,
  fillFirstAddress,
  inStockSlug,
  signInWithOtp,
} from "./support/shop"
import { tickConsent } from "./support/consent"

test("checkout: address → pay (simulated) → confirmed → cancel", async ({
  page,
}) => {
  const slug = await inStockSlug()
  test.skip(!slug, "no seeded catalogue")
  await signInWithOtp(page, "/account")

  // Add the first in-stock size to the bag.
  await page.goto(`/products/${slug}`)
  await page.waitForLoadState("networkidle")
  await chooseInStockSize(page)
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
  await tickConsent(page, "order")
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

test("checkout outside India: priced and paid in US dollars", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "covered on desktop")
  const slug = await inStockSlug()
  test.skip(!slug, "no seeded catalogue")
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const { rows } = await client.query(`
    select international_country_codes, usd_pricing_enabled, usd_rate_mode, usd_manual_rate_micros
    from store_settings where id = 1`)
  const original = rows[0]
  await client.query(`
    update store_settings set international_country_codes = array['US'], usd_pricing_enabled = true,
      usd_rate_mode = 'manual', usd_manual_rate_micros = 84500000 where id = 1`)
  await client.query(`
    insert into country_pricing (country_code, uplift_bp, shipping_fee_cents) values ('US', 1500, 2500)
    on conflict (country_code) do update set uplift_bp = 1500, shipping_fee_cents = 2500`)
  try {
    await signInWithOtp(page, "/account")
    await page.goto(`/products/${slug}`)
    await page.waitForLoadState("networkidle")
    await chooseInStockSize(page)
    await page.getByRole("button", { name: "Add to bag" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()

    await page.goto("/checkout")
    await page.getByLabel("Country").selectOption("US")
    await page.getByLabel("Full name").fill("Sam Rivera")
    await page.getByLabel(/Mobile number|Phone/).fill("+1 415 555 0100")
    await page.getByLabel("Address", { exact: true }).fill("1 Market Street")
    await page.getByLabel("Postal code").fill("94105")
    await page.getByLabel("City").fill("San Francisco")
    await tickConsent(page, "address")
    await page.getByRole("button", { name: "Save address" }).click()

    await expect(
      page.getByText("International cards, charged in US dollars."),
    ).toBeVisible()
    await expect(page.getByText("$25.00")).toBeVisible()
    await tickConsent(page, "order")
    const place = page.getByRole("button", {
      name: /Place order & pay \$\d+\.\d\d/,
    })
    await expect(place).toBeEnabled()
    const charged = (await place.textContent())!.match(/\$[\d,]+\.\d\d/)![0]
    await place.click()
    await expect(
      page.getByRole("dialog", { name: "Simulated payment" }),
    ).toContainText(charged)
    await page.getByRole("button", { name: "Pay successfully" }).click()
    await expect(
      page.getByRole("heading", { name: "Order confirmed" }),
    ).toBeVisible()
    // The success page shows what was charged, in dollars.
    await expect(page.getByText(charged).first()).toBeVisible()
  } finally {
    // Put back what was there, for the other tests.
    await client.query(
      `update store_settings set international_country_codes = $1, usd_pricing_enabled = $2,
        usd_rate_mode = $3, usd_manual_rate_micros = $4 where id = 1`,
      [
        original.international_country_codes,
        original.usd_pricing_enabled,
        original.usd_rate_mode,
        original.usd_manual_rate_micros,
      ],
    )
    await client.query(`delete from country_pricing where country_code = 'US'`)
    await client.end()
  }
})

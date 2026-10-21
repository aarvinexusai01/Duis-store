import { expect, type Page } from "@playwright/test"
import pg from "pg"

/** Shared customer steps for end-to-end tests. */

/** A live product under ₹999 with at least `variants` sizes in stock. */
export async function inStockSlug(variants = 1): Promise<string | undefined> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query<{ slug: string }>(
      `
      select p.slug::text from products p
      join product_variants v on v.product_id = p.id and v.status = 'active'
      join inventory_levels l on l.variant_id = v.id
      where p.status = 'active' and l.on_hand - l.reserved >= 5 and v.price_paise < 99900
      group by p.slug having count(distinct v.id) >= $1
      order by p.slug limit 1`,
      [variants],
    )
    return rows[0]?.slug
  } finally {
    await client.end()
  }
}

export async function signInWithOtp(page: Page, next: string) {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByRole("textbox", { name: "Mobile number" }).fill(digits)
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByText(`+91${digits}`)).toBeVisible()
  const otp = await page.request.get(
    `/api/test/otp?phone=${encodeURIComponent(`+91${digits}`)}`,
  )
  const { code } = (await otp.json()) as { code: string }
  await page.getByRole("textbox", { name: /One-time code/ }).fill(code)
  await page.getByRole("button", { name: "Verify and continue" }).click()
  await page.waitForURL((url) => url.pathname === next)
}

/**
 * Selects a size that can be bought. The page opens on the first colour,
 * which may be sold out in a long-used dev database even though another
 * colour has stock, so colours are tried in turn.
 */
export async function chooseInStockSize(page: Page): Promise<void> {
  const available = page.locator(
    'input[name="axis-size"]:not([disabled]):not([data-sold-out])',
  )
  const colours = page.locator('input[name="axis-color"]')
  const count = await colours.count()
  for (let i = 0; i < count && (await available.count()) === 0; i++) {
    await colours.nth(i).check({ force: true })
    await expect(colours.nth(i)).toBeChecked()
  }
  await available.first().check({ force: true })
}

/**
 * Signs a new customer in, buys one item with the simulated gateway and
 * returns the order number. Skips (returns null) without a seeded catalogue.
 */
export async function placePrepaidOrder(
  page: Page,
  options: { variants?: number } = {},
): Promise<string | null> {
  const slug = await inStockSlug(options.variants)
  if (!slug) return null
  await signInWithOtp(page, "/account")
  await page.goto(`/products/${slug}`)
  await page.waitForLoadState("networkidle")
  await chooseInStockSize(page)
  await page.getByRole("button", { name: "Add to bag" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.goto("/checkout")
  await expect(
    page.getByRole("heading", { level: 1, name: "Checkout" }),
  ).toBeVisible()
  await fillFirstAddress(page)
  const place = page.getByRole("button", { name: /Place order & pay/ })
  await expect(place).toBeEnabled()
  await place.click()
  await page.getByRole("button", { name: "Pay successfully" }).click()
  await expect(
    page.getByRole("heading", { name: "Order confirmed" }),
  ).toBeVisible()
  return (await page
    .getByText(/DUIS-\d{6}/)
    .first()
    .textContent())!.match(/DUIS-\d{6,}/)![0]
}

export async function fillFirstAddress(page: Page) {
  await page.getByLabel("Full name").fill("Asha Rao")
  await page.getByLabel(/Mobile number/).fill("9876543210")
  await page.getByLabel("Address", { exact: true }).fill("12 Hazratganj")
  await page.getByLabel("PIN code").fill("226001")
  await page.getByLabel("City").fill("Lucknow")
  await page.getByLabel("State").selectOption("IN-UP")
  await page.getByRole("button", { name: "Save address" }).click()
}

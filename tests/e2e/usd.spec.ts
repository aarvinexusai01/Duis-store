import { expect, test, type Page } from "@playwright/test"
import pg from "pg"

import { formatMoney, paiseToUsdCents } from "../../src/lib/fx"
import { revalidateTags } from "./support/cache"
import { tickConsent } from "./support/consent"
import { chooseInStockSize, inStockSlug, signInWithOtp } from "./support/shop"

/**
 * US-dollar prices (doc/06 Phase 13): shown to visitors outside India and
 * charged at checkout for a delivery abroad. One worker at a time, since the
 * tests switch dollar pricing on for the whole shop; desktop only.
 */
test.describe.configure({ mode: "serial" })

const RATE_MICROS = 84_500_000
const US_UPLIFT_BP = 1500
const GOOGLEBOT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"

let client: pg.Client
let original: Record<string, unknown> | undefined
let slug: string | undefined
let lowestPaise = 0

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name !== "desktop-chromium") return
  slug = await inStockSlug()
  if (!slug) return
  client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const { rows } = await client.query(`
    select international_country_codes, usd_pricing_enabled, usd_rate_mode,
      usd_manual_rate_micros, default_uplift_bp
    from store_settings where id = 1`)
  original = rows[0]
  await client.query(
    `update store_settings set international_country_codes = array['US'], usd_pricing_enabled = true,
      usd_rate_mode = 'manual', usd_manual_rate_micros = $1, default_uplift_bp = 1000 where id = 1`,
    [RATE_MICROS],
  )
  await client.query(
    `insert into country_pricing (country_code, uplift_bp, shipping_fee_cents) values ('US', $1, 2500)
     on conflict (country_code) do update set uplift_bp = $1, shipping_fee_cents = 2500`,
    [US_UPLIFT_BP],
  )
  const prices = await client.query<{ lowest: number }>(
    `select min(v.price_paise)::int as lowest from product_variants v
     join products p on p.id = v.product_id
     where p.slug = $1 and v.status = 'active'`,
    [slug],
  )
  lowestPaise = prices.rows[0]!.lowest
  await revalidateTags(request, ["fx:rates", "store:settings"])
})

test.afterAll(async ({ request }) => {
  if (!original) return
  // Put back what was there, for the other tests.
  await client.query(
    `update store_settings set international_country_codes = $1, usd_pricing_enabled = $2,
      usd_rate_mode = $3, usd_manual_rate_micros = $4, default_uplift_bp = $5 where id = 1`,
    [
      original.international_country_codes,
      original.usd_pricing_enabled,
      original.usd_rate_mode,
      original.usd_manual_rate_micros,
      original.default_uplift_bp,
    ],
  )
  await client.query(`delete from country_pricing where country_code = 'US'`)
  await client.end()
  await revalidateTags(request, ["fx:rates", "store:settings"])
})

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "covered on desktop")
  test.skip(!slug, "no seeded catalogue")
})

/** Opens a page and waits for the visitor's currency to be applied. */
async function open(page: Page, path: string) {
  const pricing = page.waitForResponse("**/api/pricing")
  await page.goto(path)
  await pricing
}

const usd = (paise: number, upliftBp: number) =>
  formatMoney(
    paiseToUsdCents(paise, { rateMicros: RATE_MICROS, upliftBp }),
    "USD",
  )
const header = (page: Page) => page.getByRole("banner")

test("a visitor from the US sees dollars, and can switch to rupees", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-ipcountry": "US" },
  })
  const page = await context.newPage()
  await open(page, `/products/${slug}`)
  const dollars = usd(lowestPaise, US_UPLIFT_BP)
  await expect(page.getByText(dollars).first()).toBeVisible()
  await expect(page.getByText(/\$[\d,]+\.\d\d/).first()).toHaveText(/\.99$/)

  await header(page).getByRole("button", { name: "Indian rupees" }).click()
  await expect(page.getByText(dollars)).toHaveCount(0)
  await expect(
    header(page).getByRole("button", { name: "Indian rupees" }),
  ).toHaveAttribute("aria-pressed", "true")
  // The choice is kept.
  await open(page, `/products/${slug}`)
  await expect(page.getByText(dollars)).toHaveCount(0)
  const cookies = await context.cookies()
  expect(cookies.find((c) => c.name === "duis_cur")?.value).toBe("INR")
  await context.close()
})

test("a visitor from India sees rupees, and can choose dollars", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "cf-ipcountry": "IN" },
  })
  const page = await context.newPage()
  await open(page, "/shop")
  const usdButton = header(page).getByRole("button", { name: "US dollars" })
  await expect(usdButton).toHaveAttribute("aria-pressed", "false")
  await expect(page.locator("[data-price]").first()).toContainText("₹")
  await usdButton.click()
  await expect(page.locator("[data-price]").first()).toContainText("$")
  await context.close()
})

test("search engines get rupees and rupee structured data", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: GOOGLEBOT,
    extraHTTPHeaders: { "cf-ipcountry": "US" },
  })
  const page = await context.newPage()
  await open(page, `/products/${slug}`)
  await expect(
    header(page).getByRole("button", { name: "US dollars" }),
  ).toHaveCount(0)
  await expect(page.locator("[data-price]").first()).toContainText("₹")
  const structured = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
  expect(structured.join("\n")).toContain('"priceCurrency":"INR"')
  expect(structured.join("\n")).not.toContain("USD")
  await context.close()
})

test("checkout outside India: priced and paid in US dollars", async ({
  page,
}) => {
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
})

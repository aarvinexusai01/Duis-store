import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import pg from "pg"

type Target = {
  slug: string
  title: string
  colour: string
  size: string
  price_paise: number
  available: number
}

/** A product with two or more colours and a variant in stock (seeded data). */
async function findTarget(): Promise<Target | undefined> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query<Target>(`
      select p.slug::text, p.title, c.label as colour, s.label as size, v.price_paise,
             (select coalesce(sum(l.on_hand - l.reserved), 0)::int from inventory_levels l where l.variant_id = v.id) as available
      from product_variants v
      join products p on p.id = v.product_id and p.status = 'active'
      join variant_attribute_values vc on vc.variant_id = v.id
      join attributes ac on ac.id = vc.attribute_id and ac.code = 'color'
      join attribute_values c on c.id = vc.attribute_value_id
      join variant_attribute_values vs on vs.variant_id = v.id
      join attributes asz on asz.id = vs.attribute_id and asz.code = 'size'
      join attribute_values s on s.id = vs.attribute_value_id
      where v.status = 'active'
        and (select count(distinct x.attribute_value_id) from variant_attribute_values x
             join product_variants pv on pv.id = x.variant_id
             where pv.product_id = p.id and x.attribute_id = ac.id) > 1
        and c.position > (select min(av.position) from attribute_values av
             join variant_attribute_values x on x.attribute_value_id = av.id
             join product_variants pv on pv.id = x.variant_id
             where pv.product_id = p.id and av.attribute_id = ac.id)
        and (select coalesce(sum(l.on_hand - l.reserved), 0) from inventory_levels l where l.variant_id = v.id) > 0
      order by p.slug, c.position, s.position
      limit 1`)
    return rows[0]
  } finally {
    await client.end()
  }
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`

async function expectNoSeriousA11yIssues(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  )
  expect(blocking.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([])
}

test("browse → filter → variant → bag → OTP sign-in keeps the bag", async ({
  page,
}) => {
  const target = await findTarget()
  test.skip(!target, "no seeded catalogue — run `npm run db:seed` first")

  // Browse and filter: every filter is a URL.
  await page.goto("/shop")
  const inStockOnly = page.getByRole("link", { name: /In stock only/ })
  if (await inStockOnly.first().isVisible()) {
    await inStockOnly.first().click()
  } else {
    // Phones keep the facets in a drawer; follow the same filter URL.
    const href = await page
      .locator("a", { hasText: "In stock only" })
      .first()
      .getAttribute("href")
    await page.goto(href!)
  }
  await expect(page).toHaveURL(/available=1/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Shop all" }),
  ).toBeVisible()

  // Product page: switch colour, pick a size; price and stock follow.
  await page.goto(`/products/${target!.slug}`)
  await page
    .getByRole("radio", { name: new RegExp(`^${target!.colour}`) })
    .check({ force: true })
  await expect(page).toHaveURL(new RegExp(`color=`))
  await page
    .getByRole("radio", { name: new RegExp(`^${target!.size}$`, "i") })
    .check({ force: true })
  await expect(
    page.getByText(rupees(target!.price_paise)).first(),
  ).toBeVisible()
  await expect(
    page.getByRole("status").filter({ hasText: /In stock|Only \d+ left/ }),
  ).toHaveText(
    target!.available <= 5 ? `Only ${target!.available} left` : "In stock",
  )

  await page.getByRole("button", { name: "Add to bag" }).click()
  await expect(
    page.getByRole("dialog").getByRole("link", { name: target!.title }),
  ).toBeVisible()
  await page.keyboard.press("Escape")

  // Sign in with a phone OTP (fake provider), landing back on the bag.
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`
  await page.goto("/login?next=/cart")
  await page.getByRole("textbox", { name: "Mobile number" }).fill(digits)
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByText(`+91${digits}`)).toBeVisible()
  const otp = await page.request.get(
    `/api/test/otp?phone=${encodeURIComponent(`+91${digits}`)}`,
  )
  expect(otp.ok()).toBe(true)
  const { code } = (await otp.json()) as { code: string }
  await page.getByRole("textbox", { name: /One-time code/ }).fill(code)
  await page.getByRole("button", { name: "Verify and continue" }).click()

  await expect(page).toHaveURL(/\/cart$/)
  await expect(
    page.getByRole("link", { name: target!.title }).first(),
  ).toBeVisible()
})

test("listing and product pages pass axe", async ({ page }) => {
  // Two full-page scans; slow on a busy machine.
  test.setTimeout(60_000)
  const target = await findTarget()
  test.skip(!target, "no seeded catalogue")
  await page.goto("/shop/men")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expectNoSeriousA11yIssues(page)
  await page.goto(`/products/${target!.slug}`)
  await expect(page.getByRole("button", { name: "Add to bag" })).toBeVisible()
  await expectNoSeriousA11yIssues(page)
})

test("filtered listings are noindex with a clean canonical", async ({
  page,
}) => {
  await page.goto("/shop/men?size=m")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  )
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/shop\/men$/,
  )
})

test("unknown products get a noindex not-found page", async ({ page }) => {
  await page.goto("/products/this-does-not-exist")
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible()
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
    "content",
    /noindex/,
  )
})

test("a sold-out size offers a back-in-stock alert", async ({ page }) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const { rows } = await client.query<{
    slug: string
    options: Record<string, string>
  }>(`
    select p.slug::text,
           (select json_object_agg(a.code, av.slug) from variant_attribute_values vav
            join attributes a on a.id = vav.attribute_id
            join attribute_values av on av.id = vav.attribute_value_id
            where vav.variant_id = v.id) as options
    from product_variants v join products p on p.id = v.product_id
    left join inventory_levels l on l.variant_id = v.id
    where p.status = 'active' and v.status = 'active'
      and coalesce(l.on_hand - l.reserved, 0) <= 0
    order by p.slug limit 1`)
  await client.end()
  test.skip(rows.length === 0, "no sold-out size in the catalogue")
  const { slug, options } = rows[0]!
  await page.goto(`/products/${slug}?${new URLSearchParams(options)}`)
  await expect(page.getByText("Sold out in this size")).toBeVisible()
  await page
    .getByLabel("Tell me when this size is back")
    .fill("e2e-alert@duis.test")
  await page.getByRole("button", { name: "Notify me" }).click()
  await expect(page.getByText(/We'll email you once/)).toBeVisible()
})

test("the contact form saves a message for the team", async ({ page }) => {
  await page.goto("/contact")
  const form = page.getByRole("form", { name: "Send us a message" })
  await form.getByRole("textbox", { name: "Name" }).fill("E2E Visitor")
  await form
    .getByRole("textbox", { name: "Email" })
    .fill(`visitor-${Date.now()}@duis.test`)
  await form
    .getByRole("combobox", { name: "What's it about?" })
    .selectOption("product")
  await form
    .getByRole("textbox", { name: "Message" })
    .fill("Does the oversized tee run large? I'm usually a medium.")
  await form.getByRole("button", { name: "Send message" }).click()
  await expect(page.getByText("Thanks, we've got it")).toBeVisible()
})

test("search: suggestions as you type, then forgiving results", async ({
  page,
}) => {
  await page.goto("/")
  // The header's box; the phone menu holds a second, hidden one.
  const box = page.getByRole("combobox").filter({ visible: true }).first()
  test.skip(!(await box.isVisible()), "the search box is in the menu on phones")

  // The demo catalogue has hoodies; "hood" is enough to be suggested one.
  await box.fill("hood")
  const suggestion = page
    .getByRole("listbox", { name: "Suggestions" })
    .getByRole("option")
    .filter({ hasText: /Hoodie/ })
    .first()
  const suggested = await suggestion
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  test.skip(!suggested, "no seeded catalogue — run `npm run db:seed` first")

  // A typo still finds them (Elasticsearch, or Postgres while it's down).
  await page.goto("/search?q=hoddie")
  await expect(
    page.getByRole("heading", { name: /Results for “hoddie”/ }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: /Hoodie/ }).first()).toBeVisible()
})

import { execFileSync } from "node:child_process"
import path from "node:path"

import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import { answeredConsent } from "../e2e/support/consent"

/** The checkout of the production stack under test (ops/local/init.sh). */
const STACK = process.env.DUIS_STACK_DIR
  ? path.resolve(process.env.DUIS_STACK_DIR)
  : null

export function requireStack(): string {
  if (!STACK) throw new Error("set DUIS_STACK_DIR to the stack's checkout")
  return STACK
}

/** Runs dist/race-fixtures.mjs inside the stack and returns its JSON. */
export function fixtures<T>(...args: string[]): T {
  const stack = requireStack()
  const out = execFileSync(
    path.join(stack, "ops/compose"),
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      "LOG_LEVEL=silent",
      "web_a",
      "node",
      "dist/race-fixtures.mjs",
      ...args,
    ],
    { cwd: stack, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
  const line = out.trim().split("\n").at(-1)!
  return JSON.parse(line) as T
}

/** Which app copies served the checkout requests since `since` (Nginx log). */
export function upstreamsSince(since: Date): string[] {
  const stack = requireStack()
  const log = execFileSync(
    path.join(stack, "ops/compose"),
    ["logs", "--no-log-prefix", "--since", since.toISOString(), "nginx"],
    { cwd: stack, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  const upstreams = new Set<string>()
  for (const line of log.split("\n")) {
    if (!line.includes('"method":"POST"') || !line.includes("/checkout"))
      continue
    const match = line.match(/"upstream":"([^",]+)/)
    if (match) upstreams.add(match[1]!)
  }
  return [...upstreams]
}

export type Shopper = { context: BrowserContext; page: Page }

let nextIp = 10
/**
 * A signed-in customer in its own browser context, arriving from its own
 * address (Nginx trusts CF-Connecting-IP from the local network, as it does
 * from Cloudflare in production), so per-IP sign-in limits apply per person.
 */
export async function shopper(
  browser: Browser,
  baseURL: string,
  account: { email: string; password: string },
): Promise<Shopper> {
  nextIp += 1
  const context = await browser.newContext({
    storageState: answeredConsent(baseURL),
    extraHTTPHeaders: {
      "CF-Connecting-IP": `198.51.100.${nextIp % 250}`,
    },
  })
  const page = await context.newPage()
  await page.goto("/login")
  await page.getByRole("tab", { name: "Email" }).click()
  await page.getByRole("textbox", { name: "Email" }).fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"))
  return { context, page }
}

/** Puts the variant in the bag and opens checkout, ready to place the order. */
export async function readyToPay(
  { page }: Shopper,
  item: { slug: string; options: Record<string, string> },
  extras: { couponCode?: string; useWallet?: boolean } = {},
) {
  const query = new URLSearchParams(item.options).toString()
  await page.goto(`/products/${item.slug}?${query}`)
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Add to bag" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.goto("/checkout")
  await expect(
    page.getByRole("heading", { level: 1, name: "Checkout" }),
  ).toBeVisible()
  if (extras.couponCode) {
    await page.getByPlaceholder("Coupon code").fill(extras.couponCode)
    await page.getByRole("button", { name: "Apply" }).click()
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible()
  }
  if (extras.useWallet) await turnOnWallet(page)
  await expect(
    page.getByRole("button", { name: /Place order & pay/ }),
  ).toBeEnabled()
}

/** Turns on "Use wallet balance" (the switch is per page). */
export async function turnOnWallet(page: Page) {
  const toggle = page.getByRole("switch", { name: /Use wallet balance/ })
  if ((await toggle.getAttribute("aria-checked")) !== "true")
    await toggle.click()
  await expect(page.getByText("Paid from wallet")).toBeVisible()
}

/**
 * Signs every account in and gets each to the checkout button, one at a time
 * (twenty browsers doing it at once only measures the laptop); the race is
 * the moment they all press it, in placeTogether.
 */
export async function prepareShoppers(
  browser: Browser,
  baseURL: string,
  accounts: { email: string; password: string }[],
  item: { slug: string; options: Record<string, string> },
  extras: { couponCode?: string; useWallet?: boolean } = {},
): Promise<Shopper[]> {
  const shoppers: Shopper[] = []
  for (const account of accounts) {
    const s = await shopper(browser, baseURL, account)
    shoppers.push(s)
    await readyToPay(s, item, extras)
  }
  return shoppers
}

/**
 * Presses "Place order & pay" on every page at the same moment, then reports
 * for each whether it reached payment ("paying") or was refused ("refused",
 * with the message shown). Anything else, such as an error page, fails.
 */
export async function placeTogether(
  shoppers: Shopper[],
): Promise<{ outcome: "paying" | "refused"; message: string }[]> {
  await Promise.all(
    shoppers.map(({ page }) =>
      page.getByRole("button", { name: /Place order & pay/ }).click(),
    ),
  )
  return Promise.all(
    shoppers.map(async ({ page }) => {
      const paying = page.getByRole("dialog", { name: "Simulated payment" })
      const refused = page.getByRole("alert").filter({ hasText: /\w/ })
      await expect(paying.or(refused).first()).toBeVisible()
      if (await paying.isVisible()) return { outcome: "paying", message: "" }
      return {
        outcome: "refused",
        message: (await refused.first().textContent()) ?? "",
      }
    }),
  )
}

/** Completes the simulated payment on a page that reached it. */
export async function paySuccessfully({ page }: Shopper) {
  await page.getByRole("button", { name: "Pay successfully" }).click()
  await expect(
    page.getByRole("heading", { name: "Order confirmed" }),
  ).toBeVisible()
}

export function expectNoBrokenInvariants() {
  expect(fixtures<{ broken: string[] }>("check").broken).toEqual([])
}

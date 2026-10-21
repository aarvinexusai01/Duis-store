import { createHmac, randomUUID } from "node:crypto"

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from "@playwright/test"

import {
  expectNoBrokenInvariants,
  fixtures,
  paySuccessfully,
  placeTogether,
  prepareShoppers,
  readyToPay,
  shopper,
  upstreamsSince,
  turnOnWallet,
  type Shopper,
} from "./support"

/**
 * Race conditions through the production stack (doc/06 Phase 7, race
 * campaign): separate signed-in customers press the same button at the same
 * moment, and Nginx spreads them over both app copies. The integration tests
 * in tests/integration/races cover every scenario at the database level.
 */

type Item = {
  variantId: string
  slug: string
  options: Record<string, string>
}
type Account = { email: string; password: string }

const baseURL = process.env.RACE_BASE_URL ?? "https://localhost:8443"

async function close(shoppers: Shopper[]) {
  await Promise.all(shoppers.map((s) => s.context.close()))
}

async function lastUnitRace(browser: Browser, customers: number) {
  const item = fixtures<Item>("stock", "1")
  const accounts = fixtures<Account[]>("customers", String(customers))
  const shoppers = await prepareShoppers(browser, baseURL, accounts, item)
  try {
    const started = new Date()
    const results = await placeTogether(shoppers)
    const paying = results.filter((r) => r.outcome === "paying")
    expect(paying).toHaveLength(1)
    for (const refused of results.filter((r) => r.outcome === "refused")) {
      expect(refused.message).toMatch(/sold out|no longer available|left/i)
    }
    // The winner pays; the unit is sold exactly once.
    await paySuccessfully(shoppers[results.indexOf(paying[0]!)]!)
    expect(fixtures<Record<string, number>>("orders", item.variantId)).toEqual({
      confirmed: 1,
    })
    expect(upstreamsSince(started).length).toBe(2)
    expectNoBrokenInvariants()
  } finally {
    await close(shoppers)
  }
}

test("S1: 3 customers, 1 unit: one order, two told it sold out", async ({
  browser,
}) => {
  await lastUnitRace(browser, 3)
})

test("S2: 20 customers, 1 unit: one order, nineteen told it sold out", async ({
  browser,
}) => {
  await lastUnitRace(browser, 20)
})

test("M1: a coupon's last use, 3 customers at once: one redemption", async ({
  browser,
}) => {
  const { code } = fixtures<{ code: string }>("coupon", "1")
  const item = fixtures<Item>("stock", "10")
  const accounts = fixtures<Account[]>("customers", "3")
  const shoppers = await prepareShoppers(browser, baseURL, accounts, item, {
    couponCode: code,
  })
  try {
    const results = await placeTogether(shoppers)
    expect(results.filter((r) => r.outcome === "paying")).toHaveLength(1)
    for (const refused of results.filter((r) => r.outcome === "refused")) {
      expect(refused.message).toMatch(/fully used/i)
    }
    expectNoBrokenInvariants()
  } finally {
    await close(shoppers)
  }
})

test("M4: the same wallet credit spent in two tabs at once: once", async ({
  browser,
}) => {
  const item = fixtures<Item>("stock", "10")
  const [account] = fixtures<Account[]>("customers", "1", "50000")
  const first = await shopper(browser, baseURL, account!)
  // A second tab in the same browser: same customer, same session.
  const second: Shopper = {
    context: first.context,
    page: await first.context.newPage(),
  }
  try {
    await readyToPay(first, item, { useWallet: true })
    await second.page.goto("/checkout")
    await turnOnWallet(second.page)
    const results = await placeTogether([first, second])
    expect(results.filter((r) => r.outcome === "paying")).toHaveLength(1)
    const refused = results.find((r) => r.outcome === "refused")
    // Either the wallet changed under the second tab, or the second tab
    // returned the same order (same bag, same session).
    if (refused) expect(refused.message).toMatch(/wallet|changed|review/i)
    expectNoBrokenInvariants()
  } finally {
    await first.context.close()
  }
})

test("P1: the payment webhook and the browser confirm at the same instant: once", async ({
  browser,
  request,
}) => {
  const item = fixtures<Item>("stock", "10")
  const [account] = fixtures<Account[]>("customers", "1")
  const buyer = await shopper(browser, baseURL, account!)
  try {
    await readyToPay(buyer, item)
    const [placed] = await placeTogether([buyer])
    expect(placed!.outcome).toBe("paying")

    // The amount the dialog asks for, e.g. "₹1,234.50", in paise.
    const shown = await buyer.page
      .getByRole("dialog", { name: "Simulated payment" })
      .getByText(/₹[\d,.]+/)
      .first()
      .textContent()
    const amountPaise = Math.round(Number(shown!.replace(/[^\d.]/g, "")) * 100)

    // When the browser sends its payment confirmation, send the gateway's
    // signed webhook for the same payment at the same moment.
    let webhook: Promise<number> | null = null
    await buyer.page.route("**/checkout**", async (route) => {
      const body = route.request().postData() ?? ""
      const match = body.match(
        /"providerOrderId":"(fake_order_\w+)","providerPaymentId":"(fake_pay_\w+)"/,
      )
      if (route.request().method() === "POST" && match && !webhook) {
        webhook = sendCapturedWebhook(
          request,
          match[1]!,
          match[2]!,
          amountPaise,
        )
      }
      await route.continue()
    })
    await paySuccessfully(buyer)
    expect(await webhook).toBe(200)
    const orderNumber = (await buyer.page
      .getByText(/DUIS-\d{6}/)
      .first()
      .textContent())!.match(/DUIS-\d{6,}/)![0]
    // The worker processes the webhook moments later.
    await expect
      .poll(() => fixtures<{ status: string }>("order", orderNumber).status)
      .toBe("confirmed")
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    expect(fixtures("order", orderNumber)).toEqual({
      status: "confirmed",
      confirmations: 1,
      emails: 1,
      refunds: 0,
      captured: 1,
    })
    expectNoBrokenInvariants()
  } finally {
    await buyer.context.close()
  }
})

/** The fake gateway's webhook, signed as the stack expects (fake mode only). */
function sendCapturedWebhook(
  request: APIRequestContext,
  providerOrderId: string,
  providerPaymentId: string,
  amountPaise: number,
): Promise<number> {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: providerPaymentId,
          order_id: providerOrderId,
          status: "captured",
          amount: amountPaise,
          currency: "INR",
          method: "upi",
        },
      },
    },
  })
  const signature = createHmac("sha256", "fake-gateway-secret-development-only")
    .update(body)
    .digest("hex")
  return request
    .post("/api/webhooks/razorpay", {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": `evt_${randomUUID()}`,
        "CF-Connecting-IP": "198.51.100.250",
      },
    })
    .then((r) => r.status())
}

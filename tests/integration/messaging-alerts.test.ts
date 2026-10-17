import { createHash } from "node:crypto"

import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { sendBackInStock, subscribeStockAlert } from "@/features/alerts"
import { addCartItem } from "@/features/cart"
import { setWhatsAppUpdates } from "@/features/customers"
import { adjustStock } from "@/features/inventory"
import {
  marketingUnsubscribeUrl,
  sendCartReminders,
  unsubscribeMarketing,
} from "@/features/marketing"
import { getAuth } from "@/server/auth/auth"
import { anonymousActor } from "@/server/auth/actor"
import { guardOtpRequest, OTP_LIMITS } from "@/server/auth/otp-guard"
import { getDb } from "@/server/db/client"
import { optOutWhatsApp, quietHoursEnd } from "@/server/notifications/whatsapp"

import { asSystem } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { buyer, paidOrder, sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

const db = () => getDb()
let variantId: string

const randomPhone = () =>
  `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`

async function logs(userId: string, channel: "email" | "whatsapp") {
  const { rows } = await db().execute<{ template: string }>(sql`
    select template from notification_logs where user_id = ${userId} and channel = ${channel}
    order by created_at`)
  return rows.map((r) => r.template)
}

beforeAll(async () => {
  ;({ variantId } = await sellableProduct())
})

describe("login code limits", () => {
  it("enforces a resend cooldown and an hourly cap per number", async () => {
    const phone = randomPhone()
    expect(await guardOtpRequest(phone, null)).toBeNull()
    expect(await guardOtpRequest(phone, null)).toMatch(/wait 30 seconds/)
    // Pretend the earlier requests were spread over the last hour. Only
    // this number's rows: other test files send codes at the same time.
    const phoneHash = createHash("sha256").update(`otp:${phone}`).digest("hex")
    await db().execute(sql`
      update otp_requests set created_at = now() - interval '10 minutes'
      where phone_hash = ${phoneHash}`)
    for (let i = 1; i < OTP_LIMITS.perPhoneHour; i += 1) {
      await db().execute(sql`
        insert into otp_requests (phone_hash, created_at)
        values (${phoneHash}, now() - interval '5 minutes')`)
    }
    expect(await guardOtpRequest(phone, null)).toMatch(/Too many codes/)
  })

  it("caps requests per IP address", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`
    for (let i = 0; i < OTP_LIMITS.perIpHour; i += 1) {
      expect(await guardOtpRequest(randomPhone(), ip)).toBeNull()
    }
    expect(await guardOtpRequest(randomPhone(), ip)).toMatch(/your network/)
  })

  it("applies through the sign-in endpoint", async () => {
    const auth = getAuth()
    const phoneNumber = randomPhone()
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber } })
    await expect(
      auth.api.sendPhoneNumberOTP({ body: { phoneNumber } }),
    ).rejects.toThrow(/wait 30 seconds/)
  })
})

describe("WhatsApp updates", () => {
  it("sends only to customers who opted in, and STOP turns it off", async () => {
    const quiet = await buyer()
    await paidOrder(quiet, variantId)
    expect(await logs(quiet.userId, "whatsapp")).toEqual([])

    const keen = await buyer()
    await setWhatsAppUpdates(keen, { enabled: true })
    await paidOrder(keen, variantId)
    expect(await logs(keen.userId, "whatsapp")).toEqual(["order_confirmed"])

    const { rows } = await db().execute<{ phone_number: string }>(
      sql`select phone_number from users where id = ${keen.userId}`,
    )
    expect(await optOutWhatsApp(rows[0]!.phone_number)).toBe(1)
    await paidOrder(keen, variantId)
    expect(await logs(keen.userId, "whatsapp")).toEqual(["order_confirmed"])
  })

  it("holds non-urgent messages until 9 am IST", () => {
    // 22:30 IST = 17:00 UTC → next day 03:30 UTC (09:00 IST).
    expect(quietHoursEnd(new Date("2026-10-16T17:00:00Z"))?.toISOString()).toBe(
      "2026-10-17T03:30:00.000Z",
    )
    // 06:00 IST = 00:30 UTC → same day 03:30 UTC.
    expect(quietHoursEnd(new Date("2026-10-16T00:30:00Z"))?.toISOString()).toBe(
      "2026-10-16T03:30:00.000Z",
    )
    // 12:00 IST: send now.
    expect(quietHoursEnd(new Date("2026-10-16T06:30:00Z"))).toBeNull()
  })
})

describe("back-in-stock alerts", () => {
  it("emails each waiting customer once when the size returns", async () => {
    const product = await sellableProduct(0)
    const sizeId = product.variantId
    expect(
      await subscribeStockAlert(anonymousActor(), {
        variantId: sizeId,
        email: "waiting@duis.test",
      }),
    ).toEqual({ status: "subscribed" })
    // The same address again: still one alert, and the same answer.
    expect(
      await subscribeStockAlert(anonymousActor(), {
        variantId: sizeId,
        email: "WAITING@duis.test",
      }),
    ).toEqual({ status: "subscribed" })
    expect(await sendBackInStock(sizeId)).toBe(0)

    await adjustStock(asSystem(), {
      variantId: sizeId,
      delta: 5,
      reason: "receive",
    })
    const queued = await db().execute(sql`
      select 1 from pgboss.job where name = 'alerts.back-in-stock' and data->>'variantId' = ${sizeId}`)
    expect(queued.rows.length).toBeGreaterThan(0)

    expect(await sendBackInStock(sizeId)).toBe(1)
    expect(await sendBackInStock(sizeId)).toBe(0)
    expect(
      await subscribeStockAlert(anonymousActor(), {
        variantId: sizeId,
        email: "late@duis.test",
      }),
    ).toEqual({ status: "in_stock" })
  })
})

describe("bag reminders", () => {
  async function idleCart(hoursAgo: number) {
    const customer = await buyer()
    await db().execute(sql`
      insert into customer_profiles (user_id, marketing_email_consent_at) values (${customer.userId}, now())
      on conflict (user_id) do update set marketing_email_consent_at = now()`)
    await addCartItem(customer, { variantId, quantity: 1 })
    await db().execute(sql`
      update carts set last_activity_at = now() - make_interval(hours => ${hoursAgo})
      where user_id = ${customer.userId} and status = 'active'`)
    return customer
  }

  it("sends at most two reminders, an hour and a day after", async () => {
    const customer = await idleCart(2)
    await sendCartReminders()
    expect(await logs(customer.userId, "email")).toContain("cart-reminder")
    await sendCartReminders()
    expect(
      (await logs(customer.userId, "email")).filter(
        (t) => t === "cart-reminder",
      ),
    ).toHaveLength(1)

    await db().execute(sql`
      update carts set last_activity_at = now() - interval '25 hours', last_reminded_at = now() - interval '24 hours'
      where user_id = ${customer.userId} and status = 'active'`)
    await sendCartReminders()
    await sendCartReminders()
    expect(
      (await logs(customer.userId, "email")).filter(
        (t) => t === "cart-reminder",
      ),
    ).toHaveLength(2)
  })

  it("skips customers without consent or who ordered since", async () => {
    const noConsent = await buyer()
    await addCartItem(noConsent, { variantId, quantity: 1 })
    await db().execute(sql`
      update carts set last_activity_at = now() - interval '2 hours' where user_id = ${noConsent.userId}`)

    const ordered = await idleCart(2)
    await paidOrder(ordered, variantId)
    await addCartItem(ordered, { variantId, quantity: 1 })
    await db().execute(sql`
      update carts set last_activity_at = now() - interval '2 hours' where user_id = ${ordered.userId} and status = 'active'`)
    await db().execute(sql`
      update orders set placed_at = now() - interval '1 hour' where user_id = ${ordered.userId}`)

    await sendCartReminders()
    expect(await logs(noConsent.userId, "email")).not.toContain("cart-reminder")
    expect(await logs(ordered.userId, "email")).not.toContain("cart-reminder")
  })

  it("unsubscribes with the signed link only", async () => {
    const customer = await idleCart(2)
    const url = new URL(marketingUnsubscribeUrl(customer.userId))
    expect(
      await unsubscribeMarketing(anonymousActor(), {
        userId: customer.userId,
        token: "x".repeat(22),
      }),
    ).toEqual({ done: false })
    expect(
      await unsubscribeMarketing(anonymousActor(), {
        userId: url.searchParams.get("u")!,
        token: url.searchParams.get("t")!,
      }),
    ).toEqual({ done: true })
    const { rows } = await db().execute<{ consent: Date | null }>(sql`
      select marketing_email_consent_at as consent from customer_profiles where user_id = ${customer.userId}`)
    expect(rows[0]!.consent).toBeNull()
  })
})

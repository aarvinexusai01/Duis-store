import { sql } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  fetchUsdRateNow,
  getUsdPricingAdmin,
  loadEffectiveUsdRate,
  refreshUsdRate,
  saveCountryPricing,
  updateUsdRateSettings,
} from "@/features/settings"
import { loadOpsChecks } from "@/features/system"
import { getDb } from "@/server/db/client"

import { createUserActor } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { buyer, code, paidOrder, sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

const db = () => getDb()

/** The constraint a statement breaks (Drizzle keeps Postgres's in `cause`). */
async function violated(statement: ReturnType<typeof sql>) {
  try {
    await db().execute(statement)
    return "nothing"
  } catch (error) {
    return (error as { cause?: { constraint?: string } }).cause?.constraint
  }
}

const ecbXml = (day: string, usd: string, inr: string) => `<?xml version="1.0"?>
<gesmes:Envelope><Cube><Cube time='${day}'>
<Cube currency='USD' rate='${usd}'/><Cube currency='INR' rate='${inr}'/>
</Cube></Cube></gesmes:Envelope>`

/** A stand-in for the network: one answer per host. */
function fakeFetch(answers: {
  ecb?: string | number
  frankfurter?: unknown
}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes("ecb.europa.eu")) {
      return typeof answers.ecb === "string"
        ? new Response(answers.ecb, { status: 200 })
        : new Response("down", { status: answers.ecb ?? 503 })
    }
    if (answers.frankfurter === undefined) {
      return new Response("down", { status: 503 })
    }
    return Response.json(answers.frankfurter)
  }) as typeof fetch
}

const resetSettings = () =>
  db().execute(sql`
    update store_settings set usd_pricing_enabled = false, usd_rate_mode = 'auto',
      usd_manual_rate_micros = null, default_uplift_bp = 0 where id = 1`)

beforeEach(async () => {
  await db().execute(sql`delete from fx_rates`)
  await resetSettings()
})
afterAll(resetSettings)

describe("the daily exchange rate", () => {
  it("stores the ECB rate once per day and uses it", async () => {
    // 91.26 / 1.08 = ₹84.50 per dollar
    const ecb = fakeFetch({ ecb: ecbXml("2026-11-04", "1.0800", "91.2600") })
    expect(await refreshUsdRate(ecb)).toMatchObject({
      rateMicros: 84_500_000,
      asOf: "2026-11-04",
      source: "ecb",
      new: true,
    })
    expect(await refreshUsdRate(ecb)).toMatchObject({ new: false })
    const rows = await db().execute(sql`select 1 from fx_rates`)
    expect(rows.rows).toHaveLength(1)
    expect(await loadEffectiveUsdRate(db())).toEqual({
      rateMicros: 84_500_000,
      source: "ecb",
      asOf: "2026-11-04",
    })
  })

  it("falls back to Frankfurter when the ECB is down", async () => {
    const result = await refreshUsdRate(
      fakeFetch({
        frankfurter: {
          amount: 1,
          base: "USD",
          date: "2026-11-04",
          rates: { INR: 84.25 },
        },
      }),
    )
    expect(result).toMatchObject({
      rateMicros: 84_250_000,
      source: "frankfurter",
    })
  })

  it("keeps the last good rate when both sources fail or a rate looks wrong", async () => {
    await refreshUsdRate(
      fakeFetch({ ecb: ecbXml("2026-11-03", "1.08", "91.26") }),
    )
    await expect(refreshUsdRate(fakeFetch({}))).rejects.toThrow(
      /No exchange rate/,
    )
    // ₹91.26 per dollar the next day is a 8% jump: refused.
    await expect(
      refreshUsdRate(fakeFetch({ ecb: ecbXml("2026-11-04", "1.00", "91.26") })),
    ).rejects.toThrow(/5%/)
    expect((await loadEffectiveUsdRate(db()))?.rateMicros).toBe(84_500_000)
  })

  it("lets staff lock a rate, which then wins", async () => {
    await refreshUsdRate(
      fakeFetch({ ecb: ecbXml("2026-11-04", "1.08", "91.26") }),
    )
    const admin = await createUserActor("store_admin")
    expect(
      await code(
        updateUsdRateSettings(admin, {
          usdRateMode: "manual",
          usdManualRateMicros: null,
          defaultUpliftBp: 0,
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    await updateUsdRateSettings(admin, {
      usdRateMode: "manual",
      usdManualRateMicros: 85_000_000,
      defaultUpliftBp: 1500,
    })
    expect(await loadEffectiveUsdRate(db())).toMatchObject({
      rateMicros: 85_000_000,
      source: "manual",
    })
    const audit = await db().execute(sql`
      select 1 from audit_logs where action = 'settings.update_usd_rate'`)
    expect(audit.rows.length).toBeGreaterThan(0)
  })

  it("turns a fetch failure into a message for staff", async () => {
    const admin = await createUserActor("store_admin")
    // No network stand-in here: a real fetch may work or not, but the
    // operation must never leak a raw error.
    const result = await fetchUsdRateNow(admin, {}).then(
      () => "ok",
      (error: { code?: string }) => error.code,
    )
    expect(["ok", "CONFLICT"]).toContain(result)
  })
})

describe("per-country pricing", () => {
  it("replaces the list, and refuses India, duplicates and other roles", async () => {
    const admin = await createUserActor("store_admin")
    await saveCountryPricing(admin, {
      countries: [
        { countryCode: "US", upliftBp: 2000, shippingFeeCents: 2500 },
        { countryCode: "AE", upliftBp: null, shippingFeeCents: 1800 },
      ],
    })
    await saveCountryPricing(admin, {
      countries: [
        { countryCode: "US", upliftBp: 2500, shippingFeeCents: 2600 },
      ],
    })
    expect((await getUsdPricingAdmin(admin, {})).countries).toEqual([
      { countryCode: "US", upliftBp: 2500, shippingFeeCents: 2600 },
    ])
    for (const countries of [
      [{ countryCode: "IN", upliftBp: null, shippingFeeCents: 0 }],
      [
        { countryCode: "US", upliftBp: null, shippingFeeCents: 100 },
        { countryCode: "US", upliftBp: null, shippingFeeCents: 200 },
      ],
    ]) {
      expect(await code(saveCountryPricing(admin, { countries }))).toBe(
        "VALIDATION_FAILED",
      )
    }
    const editor = await createUserActor("content_editor")
    expect(await code(saveCountryPricing(editor, { countries: [] }))).toBe(
      "FORBIDDEN",
    )
  })
})

describe("the database keeps USD orders honest", () => {
  it("allows USD only on export orders, and only with the rate snapshot", async () => {
    const { variantId } = await sellableProduct()
    const number = await paidOrder(await buyer(), variantId)
    // A domestic order can't become a dollar order.
    expect(
      await violated(
        sql`update orders set currency = 'USD' where order_number = ${number}`,
      ),
    ).toMatch(/orders_currency_check|orders_minor_check/)
    // Payments and refunds only know rupees and dollars.
    expect(
      await violated(sql`
        update payments set currency = 'EUR'
        where order_id = (select id from orders where order_number = ${number})`),
    ).toBe("payments_currency_check")
  })
})

describe("the stale-rate alert", () => {
  it("speaks up only while USD pricing is on and the rate is old", async () => {
    const now = new Date("2026-11-10T06:00:00Z")
    const fx = async () =>
      (await loadOpsChecks(now)).find((check) => check.key === "pricing.fx")
    await db().execute(sql`
      insert into fx_rates (rate_micros, as_of, source) values (84500000, '2026-11-03', 'ecb')`)
    expect(await fx()).toBeUndefined()
    await db().execute(
      sql`update store_settings set usd_pricing_enabled = true where id = 1`,
    )
    expect(await fx()).toMatchObject({ ok: false })
    await db().execute(sql`
      insert into fx_rates (rate_micros, as_of, source) values (84500000, '2026-11-09', 'ecb')`)
    expect(await fx()).toMatchObject({ ok: true })
    // A locked rate never goes stale.
    await db().execute(sql`delete from fx_rates`)
    await db().execute(sql`
      update store_settings set usd_rate_mode = 'manual', usd_manual_rate_micros = 85000000 where id = 1`)
    expect(await fx()).toBeUndefined()
  })
})

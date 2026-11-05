import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { getPaymentGateway } from "@/features/payments"
import { COUNTRY_CODE_SET } from "@/lib/countries"
import {
  parseEcbUsdInr,
  parseFrankfurterUsdInr,
  rateProblem,
  type PublishedRate,
} from "@/lib/fx"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import type { Database } from "@/server/db/client"
import { getDb } from "@/server/db/client"
import { type Transaction, withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { logger } from "@/server/observability/logger"
import { defineOperation } from "@/server/operation"

import { saveSection } from "./admin"

/**
 * US-dollar pricing outside India (doc/06 Phase 13, ADR-0034): the daily
 * rate, the rate in force, and the per-country increase and shipping fee.
 */

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
const FRANKFURTER_URL =
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR"
const TIMEOUT_MS = 10_000

export type EffectiveRate = {
  rateMicros: number
  source: string
  asOf: string
}

/** The rate new USD prices use: the locked one, or the latest fetched. */
export async function loadEffectiveUsdRate(
  db: Database | Transaction,
): Promise<EffectiveRate | null> {
  const found = await db.execute<{
    mode: string
    manual: number | null
    rate: number | null
    source: string | null
    as_of: string | null
    updated_at: Date
  }>(sql`
    select s.usd_rate_mode as mode, s.usd_manual_rate_micros as manual, s.updated_at,
      r.rate_micros as rate, r.source, r.as_of::text as as_of
    from store_settings s
    left join lateral (select * from fx_rates order by as_of desc limit 1) r on true
    where s.id = 1`)
  const row = found.rows[0]
  if (!row) return null
  if (row.mode === "manual" && row.manual) {
    return {
      rateMicros: row.manual,
      source: "manual",
      asOf: new Date(row.updated_at).toISOString().slice(0, 10),
    }
  }
  return row.rate && row.source && row.as_of
    ? { rateMicros: row.rate, source: row.source, asOf: row.as_of }
    : null
}

type Fetch = typeof fetch

async function fetchPublishedRate(
  fetchImpl: Fetch,
): Promise<PublishedRate & { source: string }> {
  const problems: string[] = []
  try {
    const response = await fetchImpl(ECB_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const parsed = response.ok ? parseEcbUsdInr(await response.text()) : null
    if (parsed) return { ...parsed, source: "ecb" }
    problems.push(`ECB answered ${response.status}`)
  } catch (error) {
    problems.push(`ECB: ${(error as Error).message}`)
  }
  try {
    const response = await fetchImpl(FRANKFURTER_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const parsed = response.ok
      ? parseFrankfurterUsdInr(await response.json())
      : null
    if (parsed) return { ...parsed, source: "frankfurter" }
    problems.push(`Frankfurter answered ${response.status}`)
  } catch (error) {
    problems.push(`Frankfurter: ${(error as Error).message}`)
  }
  throw new Error(`No exchange rate: ${problems.join("; ")}`)
}

/**
 * pricing.refresh-fx: stores today's published rate. An implausible rate or
 * a jump of over 5% is refused (the job throws, so it retries and then the
 * ops check warns) and the last good rate stays in force.
 */
export async function refreshUsdRate(
  fetchImpl: Fetch = fetch,
): Promise<{ rateMicros: number; asOf: string; source: string; new: boolean }> {
  const published = await fetchPublishedRate(fetchImpl)
  const db = getDb()
  const last = await db.execute<{ rate: number }>(
    sql`select rate_micros as rate from fx_rates order by as_of desc limit 1`,
  )
  const problem = rateProblem(published.rateMicros, last.rows[0]?.rate ?? null)
  if (problem) throw new Error(`Exchange rate refused: ${problem}`)
  const inserted = await withTransaction(async (tx) => {
    const added = await tx.execute(sql`
      insert into fx_rates (rate_micros, as_of, source)
      values (${published.rateMicros}, ${published.asOf}, ${published.source})
      on conflict (base, quote, as_of) do nothing
      returning id`)
    if (added.rows.length > 0) {
      await requestRevalidation([cacheTags.fxRates], { tx })
    }
    return added.rows.length > 0
  })
  if (inserted) logger.info(published, "exchange rate stored")
  return { ...published, new: inserted }
}

// --- Admin ---------------------------------------------------------------------

export type UsdPricingAdmin = {
  effective: EffectiveRate | null
  latest: {
    rateMicros: number
    source: string
    asOf: string
    fetchedAt: Date
  } | null
  countries: {
    countryCode: string
    upliftBp: number | null
    shippingFeeCents: number
  }[]
}

export const getUsdPricingAdmin = defineOperation({
  name: "settings.getUsdPricing",
  access: { settings: ["read"] },
  input: z.object({}),
  async handler(): Promise<UsdPricingAdmin> {
    const db = getDb()
    const [effective, latest, countries] = await Promise.all([
      loadEffectiveUsdRate(db),
      db.execute<{
        rate_micros: number
        source: string
        as_of: string
        fetched_at: Date
      }>(sql`
        select rate_micros, source, as_of::text as as_of, fetched_at
        from fx_rates order by as_of desc limit 1`),
      db.execute<{
        country_code: string
        uplift_bp: number | null
        shipping_fee_cents: number
      }>(sql`
        select country_code, uplift_bp, shipping_fee_cents from country_pricing order by country_code`),
    ])
    const l = latest.rows[0]
    return {
      effective,
      latest: l
        ? {
            rateMicros: l.rate_micros,
            source: l.source,
            asOf: l.as_of,
            fetchedAt: new Date(l.fetched_at),
          }
        : null,
      countries: countries.rows.map((row) => ({
        countryCode: row.country_code,
        upliftBp: row.uplift_bp,
        shippingFeeCents: row.shipping_fee_cents,
      })),
    }
  },
})

/** The rate mode, the locked rate and the default increase. */
export const updateUsdRateSettings = defineOperation({
  name: "settings.updateUsdRate",
  access: { settings: ["update"] },
  input: z
    .object({
      usdRateMode: z.enum(["auto", "manual"]),
      usdManualRateMicros: z
        .number()
        .int()
        .min(10_000_000, "Enter rupees per dollar, e.g. 84.50.")
        .max(500_000_000, "Enter rupees per dollar, e.g. 84.50.")
        .nullable(),
      defaultUpliftBp: z
        .number()
        .int()
        .min(0, "The increase can't be negative.")
        .max(10_000, "At most 100%."),
    })
    .refine(
      (input) => input.usdRateMode === "auto" || input.usdManualRateMicros,
      {
        path: ["usdManualRateMicros"],
        message: "Enter the rate to use.",
      },
    ),
  async handler({ actor }, input) {
    const result = await saveSection(actor, "usd_rate", input)
    await requestRevalidation([cacheTags.fxRates])
    return result
  },
})

const countryRow = z.object({
  countryCode: z
    .string()
    .refine(
      (code) => code !== "IN" && COUNTRY_CODE_SET.has(code),
      "Unknown country.",
    ),
  upliftBp: z.number().int().min(0).max(10_000).nullable(),
  shippingFeeCents: z
    .number()
    .int()
    .min(0, "The fee can't be negative.")
    .max(1_000_000),
})

/** Replaces the per-country increases and shipping fees. */
export const saveCountryPricing = defineOperation({
  name: "settings.saveCountryPricing",
  access: { settings: ["update"] },
  input: z.object({ countries: z.array(countryRow).max(250) }),
  async handler({ actor }, { countries }) {
    const codes = countries.map((row) => row.countryCode)
    if (new Set(codes).size !== codes.length) {
      throw new DomainError("VALIDATION_FAILED", "A country is listed twice.")
    }
    await withTransaction(async (tx) => {
      await tx.execute(sql`
        delete from country_pricing
        where not (country_code = any(${`{${codes.join(",")}}`}::text[]))`)
      for (const row of countries) {
        await tx.execute(sql`
          insert into country_pricing (country_code, uplift_bp, shipping_fee_cents)
          values (${row.countryCode}, ${row.upliftBp}, ${row.shippingFeeCents})
          on conflict (country_code) do update set uplift_bp = excluded.uplift_bp,
            shipping_fee_cents = excluded.shipping_fee_cents, updated_at = now()`)
      }
      await writeAudit(tx, actor, {
        action: "settings.update_country_pricing",
        entityType: "store_settings",
        entityId: "1",
        changes: { countries },
      })
      await requestRevalidation([cacheTags.fxRates], { tx })
    })
    return {}
  },
})

/**
 * Switches dollar pricing on or off. Switching on checks first that a rate
 * is in force, a shipping country has its fee, and Razorpay accepts USD (a
 * $1 order that is never paid: creating one charges nothing).
 */
export const setUsdPricingEnabled = defineOperation({
  name: "settings.setUsdPricing",
  access: { settings: ["update"] },
  input: z.object({ enabled: z.boolean() }),
  async handler({ actor, log }, { enabled }) {
    if (enabled) {
      const db = getDb()
      if (!(await loadEffectiveUsdRate(db))) {
        throw new DomainError(
          "INVALID_STATE",
          "There's no exchange rate yet. Fetch one, or set a fixed rate.",
        )
      }
      const priced = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from country_pricing c, store_settings s
        where s.id = 1 and c.country_code = any(s.international_country_codes)`)
      if (priced.rows[0]!.n === 0) {
        throw new DomainError(
          "INVALID_STATE",
          "Give at least one shipping country its fee first.",
        )
      }
      try {
        await getPaymentGateway().createOrder({
          amountPaise: 100,
          currency: "USD",
          receipt: "usd-preflight",
          notes: { purpose: "Checking USD is enabled" },
        })
      } catch (error) {
        log.warn({ err: error }, "USD preflight refused by the gateway")
        throw new DomainError(
          "INVALID_STATE",
          "Razorpay hasn't enabled US dollars on this account yet. Ask Razorpay to enable international payments and USD, then try again.",
        )
      }
    }
    const result = await saveSection(
      actor,
      "usd_pricing",
      { usdPricingEnabled: enabled },
      { storefront: true },
    )
    await requestRevalidation([cacheTags.fxRates])
    return result
  },
})

/** "Fetch now" on the settings page. */
export const fetchUsdRateNow = defineOperation({
  name: "settings.fetchUsdRate",
  access: { settings: ["update"] },
  input: z.object({}),
  async handler() {
    try {
      return await refreshUsdRate()
    } catch (error) {
      throw new DomainError("CONFLICT", (error as Error).message)
    }
  },
})

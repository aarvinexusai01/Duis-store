import "server-only"
import { sql, type SQL } from "drizzle-orm"
import { z } from "zod"

import { COUNTRY_CODE_SET } from "@/lib/countries"
import { INDIAN_STATE_CODES } from "@/lib/india"
import type { Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

/**
 * Store settings (doc/06 Phase 4 §12). Each section saves on its own, is
 * audited with before and after values, and refreshes the storefront where
 * customers see it. Changes apply to new orders only: placed orders keep
 * their prices, tax lines and COD terms.
 */

export type AdminSettings = {
  legalName: string | null
  gstin: string | null
  registeredStateCode: string
  iecCode: string | null
  lutReference: string | null
  freeShippingThresholdPaise: number
  internationalCountryCodes: string[]
  partialCodEnabled: boolean
  codAdvanceType: "fixed" | "percent"
  codAdvanceValue: number
  codMaxOrderPaise: number
  codFeePaise: number
  rtoAdvancePolicy: "keep" | "refund" | "wallet"
  exchangeWindowDays: number
  maxExchangesPerItem: number
  reservationTtlMinutes: number
  promoCreditValidityDays: number
  emailSenderName: string
  emailReplyTo: string | null
  notifyOrderShipped: boolean
  notifyPaymentReminder: boolean
  notifyLowStock: boolean
  updatedAt: Date
  taxRules: {
    id: string
    hsnPrefix: string
    priceThresholdPaise: number | null
    rateBelowBp: number
    rateAboveBp: number
    effectiveFrom: string
    effectiveTo: string | null
  }[]
}

const COLUMNS: Record<
  keyof Omit<AdminSettings, "taxRules" | "updatedAt">,
  string
> = {
  legalName: "legal_name",
  gstin: "gstin",
  registeredStateCode: "registered_state_code",
  iecCode: "iec_code",
  lutReference: "lut_reference",
  freeShippingThresholdPaise: "free_shipping_threshold_paise",
  internationalCountryCodes: "international_country_codes",
  partialCodEnabled: "partial_cod_enabled",
  codAdvanceType: "cod_advance_type",
  codAdvanceValue: "cod_advance_value",
  codMaxOrderPaise: "cod_max_order_paise",
  codFeePaise: "cod_fee_paise",
  rtoAdvancePolicy: "rto_advance_policy",
  exchangeWindowDays: "exchange_window_days",
  maxExchangesPerItem: "max_exchanges_per_item",
  reservationTtlMinutes: "reservation_ttl_minutes",
  promoCreditValidityDays: "promo_credit_validity_days",
  emailSenderName: "email_sender_name",
  emailReplyTo: "email_reply_to",
  notifyOrderShipped: "notify_order_shipped",
  notifyPaymentReminder: "notify_payment_reminder",
  notifyLowStock: "notify_low_stock",
}

export const getAdminSettings = defineOperation({
  name: "settings.get",
  access: { settings: ["read"] },
  input: z.object({}),
  async handler(): Promise<AdminSettings> {
    const db = getDb()
    const [row, rules] = await Promise.all([
      db.execute<Record<string, unknown>>(
        sql`select * from store_settings where id = 1`,
      ),
      db.execute<{
        id: string
        hsn_prefix: string
        price_threshold_paise: number | null
        rate_below_bp: number
        rate_above_bp: number
        effective_from: string
        effective_to: string | null
      }>(sql`
        select id, hsn_prefix, price_threshold_paise, rate_below_bp, rate_above_bp,
               effective_from::text, effective_to::text
        from tax_rules order by hsn_prefix, effective_from desc`),
    ])
    const r = row.rows[0]
    if (!r) throw new Error("store_settings row is missing (run migrations)")
    const settings = Object.fromEntries(
      Object.entries(COLUMNS).map(([key, column]) => [key, r[column]]),
    ) as Omit<AdminSettings, "taxRules" | "updatedAt">
    return {
      ...settings,
      updatedAt: new Date(r.updated_at as string),
      taxRules: rules.rows.map((t) => ({
        id: t.id,
        hsnPrefix: t.hsn_prefix,
        priceThresholdPaise: t.price_threshold_paise,
        rateBelowBp: t.rate_below_bp,
        rateAboveBp: t.rate_above_bp,
        effectiveFrom: t.effective_from,
        effectiveTo: t.effective_to,
      })),
    }
  },
})

/**
 * Saves some settings columns: reads the old values, updates, audits the
 * difference and, when customers see them, refreshes the storefront.
 */
async function saveSection(
  actor: Actor,
  section: string,
  values: Partial<Record<keyof typeof COLUMNS, unknown>>,
  options: { storefront?: boolean } = {},
) {
  return withTransaction(async (tx) => {
    const keys = Object.keys(values) as (keyof typeof COLUMNS)[]
    const before = await tx.execute<Record<string, unknown>>(sql`
      select ${sql.join(
        keys.map((k) => sql.identifier(COLUMNS[k])),
        sql`, `,
      )} from store_settings where id = 1 for update`)
    const assignments: SQL[] = keys.map((k) => {
      const value = values[k]
      return Array.isArray(value)
        ? sql`${sql.identifier(COLUMNS[k])} = ${`{${value.join(",")}}`}::text[]`
        : sql`${sql.identifier(COLUMNS[k])} = ${value as string | number | boolean | null}`
    })
    await tx.execute(sql`
      update store_settings set ${sql.join(assignments, sql`, `)}, updated_at = now() where id = 1`)
    const old = before.rows[0] ?? {}
    const changes = Object.fromEntries(
      keys
        .map((k) => [k, { from: old[COLUMNS[k]], to: values[k] }] as const)
        .filter(([, c]) => JSON.stringify(c.from) !== JSON.stringify(c.to)),
    )
    if (Object.keys(changes).length > 0) {
      await writeAudit(tx, actor, {
        action: `settings.update_${section}`,
        entityType: "store_settings",
        entityId: "1",
        changes,
      })
      if (options.storefront) {
        await requestRevalidation([cacheTags.storeSettings], { tx })
      }
    }
    return { changed: Object.keys(changes) }
  })
}

const optionalText = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || pattern.test(v), message)
    .nullable()

export const updateLegalSettings = defineOperation({
  name: "settings.updateLegal",
  access: { settings: ["update"] },
  input: z.object({
    legalName: z
      .string()
      .trim()
      .max(200)
      .transform((v) => v || null)
      .nullable(),
    // 15 characters: 2-digit state code, PAN, entity number, Z, checksum.
    gstin: optionalText(
      /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
      "Enter a 15-character GSTIN.",
    ),
    registeredStateCode: z
      .string()
      .refine((code) => INDIAN_STATE_CODES.has(code), "Choose a state."),
    iecCode: optionalText(/^[0-9A-Z]{10}$/, "An IEC has 10 characters."),
    lutReference: z
      .string()
      .trim()
      .max(60)
      .transform((v) => v || null)
      .nullable(),
  }),
  async handler({ actor }, input) {
    return saveSection(actor, "legal", input)
  },
})

export const updateShippingSettings = defineOperation({
  name: "settings.updateShipping",
  access: { settings: ["update"] },
  input: z.object({
    freeShippingThresholdPaise: z.number().int().min(0).max(10_000_000),
    internationalCountryCodes: z
      .array(
        z
          .string()
          .refine(
            (code) => code !== "IN" && COUNTRY_CODE_SET.has(code),
            "Unknown country.",
          ),
      )
      .max(250)
      .transform((codes) => [...new Set(codes)].sort()),
  }),
  async handler({ actor }, input) {
    return saveSection(actor, "shipping", input, { storefront: true })
  },
})

export const updateCodSettings = defineOperation({
  name: "settings.updateCod",
  access: { settings: ["update"] },
  input: z
    .object({
      partialCodEnabled: z.boolean(),
      codAdvanceType: z.enum(["fixed", "percent"]),
      // Paise when fixed, basis points when percent.
      codAdvanceValue: z.number().int().min(0),
      codMaxOrderPaise: z.number().int().min(0).max(10_000_000),
      codFeePaise: z.number().int().min(0).max(100_000),
      rtoAdvancePolicy: z.enum(["keep", "refund", "wallet"]),
    })
    .refine(
      (v) =>
        v.codAdvanceType === "fixed"
          ? v.codAdvanceValue >= 100
          : v.codAdvanceValue >= 100 && v.codAdvanceValue <= 9_000,
      {
        path: ["codAdvanceValue"],
        message:
          "The advance is at least ₹1, or between 1% and 90% of the order.",
      },
    ),
  async handler({ actor }, input) {
    return saveSection(actor, "cod", input, { storefront: true })
  },
})

export const updatePolicySettings = defineOperation({
  name: "settings.updatePolicies",
  access: { settings: ["update"] },
  input: z.object({
    exchangeWindowDays: z.number().int().min(0).max(60),
    maxExchangesPerItem: z.number().int().min(0).max(5),
    reservationTtlMinutes: z.number().int().min(5).max(60),
    promoCreditValidityDays: z.number().int().min(1).max(365),
  }),
  async handler({ actor }, input) {
    return saveSection(actor, "policies", input, { storefront: true })
  },
})

export const updateNotificationSettings = defineOperation({
  name: "settings.updateNotifications",
  access: { settings: ["update"] },
  input: z.object({
    emailSenderName: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[^<>"\r\n]+$/, "No quotes or angle brackets."),
    emailReplyTo: z
      .union([z.email(), z.literal("")])
      .transform((v) => v || null)
      .nullable(),
    notifyOrderShipped: z.boolean(),
    notifyPaymentReminder: z.boolean(),
    notifyLowStock: z.boolean(),
  }),
  async handler({ actor }, input) {
    return saveSection(actor, "notifications", input)
  },
})

/**
 * Adds a GST slab from a date. The current open rule for the same HSN prefix
 * ends the day before; past orders keep the tax they were charged.
 */
export const addTaxRule = defineOperation({
  name: "settings.addTaxRule",
  access: { settings: ["update"] },
  input: z.object({
    hsnPrefix: z.string().regex(/^[0-9]{2,8}$/, "2 to 8 digits."),
    priceThresholdPaise: z.number().int().min(1).nullable(),
    rateBelowBp: z.number().int().min(0).max(10_000),
    rateAboveBp: z.number().int().min(0).max(10_000),
    effectiveFrom: z.iso.date(),
  }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const later = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from tax_rules
        where hsn_prefix = ${input.hsnPrefix} and effective_from >= ${input.effectiveFrom}::date`)
      if (later.rows[0]!.n > 0) {
        throw new DomainError(
          "CONFLICT",
          "A rule for this HSN already starts on or after that date.",
          { issues: { effectiveFrom: ["Pick a later date."] } },
        )
      }
      await tx.execute(sql`
        update tax_rules set effective_to = ${input.effectiveFrom}::date - 1, updated_at = now()
        where hsn_prefix = ${input.hsnPrefix} and (effective_to is null or effective_to >= ${input.effectiveFrom}::date)`)
      const created = await tx.execute<{ id: string }>(sql`
        insert into tax_rules (hsn_prefix, price_threshold_paise, rate_below_bp, rate_above_bp, effective_from)
        values (${input.hsnPrefix}, ${input.priceThresholdPaise}, ${input.rateBelowBp}, ${input.rateAboveBp},
                ${input.effectiveFrom}::date)
        returning id`)
      await writeAudit(tx, actor, {
        action: "settings.add_tax_rule",
        entityType: "tax_rule",
        entityId: created.rows[0]!.id,
        changes: input,
      })
      return { id: created.rows[0]!.id }
    })
  },
})

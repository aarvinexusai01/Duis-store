import "server-only"
import { sql } from "drizzle-orm"

import { formatPaise } from "@/lib/money"
import { getDb } from "@/server/db/client"

/** The store rules customers see (doc/01 decisions D5–D8), from store_settings. */
export type StorePolicy = {
  freeShippingThresholdPaise: number
  exchangeWindowDays: number
  maxExchangesPerItem: number
  partialCodEnabled: boolean
  codAdvanceType: "fixed" | "percent"
  codAdvanceValue: number
  codMaxOrderPaise: number
  codFeePaise: number
}

export async function loadStorePolicy(): Promise<StorePolicy> {
  const result = await getDb().execute<{
    free_shipping_threshold_paise: number
    exchange_window_days: number
    max_exchanges_per_item: number
    partial_cod_enabled: boolean
    cod_advance_type: "fixed" | "percent"
    cod_advance_value: number
    cod_max_order_paise: number
    cod_fee_paise: number
  }>(sql`
    select free_shipping_threshold_paise, exchange_window_days, max_exchanges_per_item, partial_cod_enabled,
           cod_advance_type, cod_advance_value, cod_max_order_paise, cod_fee_paise
    from store_settings where id = 1`)
  const r = result.rows[0]
  if (!r) throw new Error("store_settings row is missing (run migrations)")
  return {
    freeShippingThresholdPaise: r.free_shipping_threshold_paise,
    exchangeWindowDays: r.exchange_window_days,
    maxExchangesPerItem: r.max_exchanges_per_item,
    partialCodEnabled: r.partial_cod_enabled,
    codAdvanceType: r.cod_advance_type,
    codAdvanceValue: r.cod_advance_value,
    codMaxOrderPaise: r.cod_max_order_paise,
    codFeePaise: r.cod_fee_paise,
  }
}

/** "₹100" or "10%": what a partial-COD customer pays online first. */
export function describeCodAdvance(policy: StorePolicy): string {
  return policy.codAdvanceType === "fixed"
    ? formatPaise(policy.codAdvanceValue)
    : `${policy.codAdvanceValue / 100}%`
}

import "server-only"
import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { logger } from "@/server/observability/logger"

import type { ShippingProvider } from "./provider"
import {
  parseShiprocketTime,
  parseShiprocketTracking,
} from "./shiprocket-format"

/**
 * Shiprocket over its REST API (doc/03 §6). UNVERIFIED: written from
 * Shiprocket's public API documentation, and checked with one real,
 * cancelled test shipment once the account exists (doc/10 A5, I1). Until
 * then development and CI use the fake provider.
 *
 * ⚠ To verify with the account:
 * - partial-COD parcels send only the balance as the collectable amount
 *   (sub_total with total_discount), doc/10 question 5;
 * - Shiprocket X (international) booking, which is refused here for now.
 */
const BASE = "https://apiv2.shiprocket.in/v1/external"
// Tokens are valid for 240 hours; refresh a day early.
const TOKEN_LIFETIME_MS = 9 * 24 * 3600 * 1000
const TIMEOUT_MS = 15_000

class ShiprocketError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function login(): Promise<string> {
  const env = getServerEnv()
  const response = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: env.SHIPROCKET_API_EMAIL,
      password: env.SHIPROCKET_API_PASSWORD,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = (await response.json().catch(() => ({}))) as { token?: string }
  if (!response.ok || !body.token) {
    throw new ShiprocketError(response.status, "Shiprocket login failed")
  }
  await getDb().execute(sql`
    insert into provider_tokens (provider, token, expires_at)
    values ('shiprocket', ${body.token}, ${new Date(Date.now() + TOKEN_LIFETIME_MS)})
    on conflict (provider) do update set token = excluded.token, expires_at = excluded.expires_at, updated_at = now()`)
  return body.token
}

async function token(): Promise<string> {
  const stored = await getDb().execute<{ token: string }>(sql`
    select token from provider_tokens where provider = 'shiprocket' and expires_at > now()`)
  return stored.rows[0]?.token ?? login()
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token()}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 401 && !retried) {
    await getDb().execute(
      sql`delete from provider_tokens where provider = 'shiprocket'`,
    )
    return call(method, path, body, true)
  }
  const json = (await response.json().catch(() => ({}))) as T & {
    message?: string
  }
  if (!response.ok) {
    logger.warn({ path, status: response.status }, "shiprocket call failed")
    throw new ShiprocketError(
      response.status,
      `Shiprocket: ${json.message ?? `HTTP ${response.status}`}`,
    )
  }
  return json
}

const rupees = (paise: number) => Number((paise / 100).toFixed(2))

type CourierOption = {
  courier_company_id: number
  courier_name: string
  rate: number
  cod: number
  estimated_delivery_days?: string | number
}

async function couriers(
  pincode: string,
  weightGrams: number,
  cod: boolean,
): Promise<{ options: CourierOption[]; recommended: number | null }> {
  const env = getServerEnv()
  const query = new URLSearchParams({
    pickup_postcode: env.SHIPROCKET_PICKUP_PINCODE ?? "",
    delivery_postcode: pincode,
    weight: String(Math.max(0.1, weightGrams / 1000)),
    cod: cod ? "1" : "0",
  })
  type Answer = {
    data?: {
      available_courier_companies?: CourierOption[]
      recommended_courier_company_id?: number
    }
  }
  const result = await call<Answer>(
    "GET",
    `/courier/serviceability/?${query}`,
  ).catch((error: unknown): Answer => {
    // 404 means no courier serves this PIN code.
    if (error instanceof ShiprocketError && error.status === 404) return {}
    throw error
  })
  return {
    options: result.data?.available_courier_companies ?? [],
    recommended: result.data?.recommended_courier_company_id ?? null,
  }
}

export const shiprocketProvider: ShippingProvider = {
  name: "shiprocket",
  async checkServiceability(pincode) {
    const { options } = await couriers(pincode, 500, false)
    const days = options
      .map((o) => Number(o.estimated_delivery_days))
      .filter((d) => Number.isFinite(d) && d > 0)
    return {
      serviceable: options.length > 0,
      prepaidAvailable: options.length > 0,
      codAvailable: options.some((o) => o.cod === 1),
      eddMinDays: days.length ? Math.min(...days) : null,
      eddMaxDays: days.length ? Math.max(...days) : null,
    }
  },
  async quoteRate({ countryCode, pincode, weightGrams, cod }) {
    // International rates come from Shiprocket X once verified; until then
    // international delivery shows as unavailable rather than a guess.
    if (countryCode !== "IN" || !pincode) return null
    const { options, recommended } = await couriers(pincode, weightGrams, cod)
    const pick =
      options.find((o) => o.courier_company_id === recommended) ?? options[0]
    return pick ? Math.round(pick.rate * 100) : null
  },
  async createShipment(request) {
    if (request.customs) {
      throw new DomainError(
        "INVALID_STATE",
        "International parcels through Shiprocket X are not connected yet. Book this one in the Shiprocket panel.",
      )
    }
    const env = getServerEnv()
    const to = request.consignee
    const [first, ...rest] = to.name.trim().split(/\s+/)
    const itemsTotal = request.items.reduce(
      (sum, item) => sum + item.unitPricePaise * item.units,
      0,
    )
    const cod = request.codAmountPaise > 0
    const result = await call<{
      order_id?: number
      shipment_id?: number
    }>("POST", "/orders/create/adhoc", {
      order_id: request.channelOrderId,
      order_date: request.orderDate
        .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
        .slice(0, 16),
      pickup_location: env.SHIPROCKET_PICKUP_LOCATION,
      billing_customer_name: first,
      billing_last_name: rest.join(" "),
      billing_address: to.line1,
      billing_address_2: to.line2 ?? "",
      billing_city: to.city,
      billing_pincode: to.postalCode,
      billing_state: to.state ?? "",
      billing_country: "India",
      billing_email: to.email ?? "",
      billing_phone: to.phone.replace(/^\+91/, ""),
      shipping_is_billing: true,
      order_items: request.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        units: item.units,
        selling_price: rupees(item.unitPricePaise),
        hsn: item.hsn,
      })),
      payment_method: cod ? "COD" : "Prepaid",
      // ⚠ Verify: a partial-COD parcel collects only the balance.
      sub_total: rupees(cod ? request.codAmountPaise : request.subTotalPaise),
      total_discount: rupees(
        Math.max(
          0,
          itemsTotal - (cod ? request.codAmountPaise : request.subTotalPaise),
        ),
      ),
      length: request.lengthCm,
      breadth: request.breadthCm,
      height: request.heightCm,
      weight: Math.max(0.1, request.weightGrams / 1000),
    })
    if (!result.order_id || !result.shipment_id) {
      throw new Error("Shiprocket did not return an order and shipment id")
    }
    return {
      providerOrderId: String(result.order_id),
      providerShipmentId: String(result.shipment_id),
    }
  },
  async assignAwb(providerShipmentId) {
    const result = await call<{
      awb_assign_status?: number
      response?: { data?: { awb_code?: string; courier_name?: string } }
    }>("POST", "/courier/assign/awb", {
      shipment_id: Number(providerShipmentId),
    })
    const data = result.response?.data
    if (result.awb_assign_status !== 1 || !data?.awb_code) {
      throw new Error("Shiprocket did not assign an AWB")
    }
    return {
      awb: data.awb_code,
      courierName: data.courier_name ?? "Courier",
    }
  },
  async label({ providerShipmentId }) {
    const result = await call<{ label_created?: number; label_url?: string }>(
      "POST",
      "/courier/generate/label",
      { shipment_id: [Number(providerShipmentId)] },
    )
    const url = result.label_url
    if (result.label_created !== 1 || !url?.startsWith("https://")) {
      throw new Error("Shiprocket did not create a label")
    }
    const file = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const data = Buffer.from(await file.arrayBuffer())
    if (
      !file.ok ||
      data.length > 5_000_000 ||
      !data.subarray(0, 5).equals(Buffer.from("%PDF-"))
    ) {
      throw new Error("Shiprocket label download failed")
    }
    return data
  },
  async requestPickup(providerShipmentId) {
    const result = await call<{
      pickup_status?: number
      response?: { pickup_scheduled_date?: string }
    }>("POST", "/courier/generate/pickup", {
      shipment_id: [Number(providerShipmentId)],
    })
    if (result.pickup_status !== 1) {
      throw new Error("Shiprocket did not schedule a pickup")
    }
    return {
      scheduledAt: parseShiprocketTime(result.response?.pickup_scheduled_date),
    }
  },
  async cancel({ providerOrderId, awb }) {
    if (awb) {
      await call("POST", "/orders/cancel/shipment/awbs", { awbs: [awb] })
    }
    await call("POST", "/orders/cancel", { ids: [Number(providerOrderId)] })
  },
  async track(awb) {
    const result = await call<unknown>(
      "GET",
      `/courier/track/awb/${encodeURIComponent(awb)}`,
    )
    return parseShiprocketTracking(result)
  },
}

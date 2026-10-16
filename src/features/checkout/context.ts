import "server-only"
import { createHash } from "node:crypto"
import { sql } from "drizzle-orm"

import type { ShippingAddressSnapshot } from "@/db/schema"
import { findUsableCoupon, loadAutomaticDiscounts } from "@/features/discounts"
import {
  quote as priceQuote,
  quoteFingerprint,
  type PaymentModeInput,
  type PricingCoupon,
  type PricingLine,
  type Quote,
  type QuoteIssue,
  type TaxRule,
} from "@/features/pricing"
import { checkServiceability, getShippingProvider } from "@/features/shipping"
import { spendableBalance } from "@/features/wallet"
import type { UserActor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"

/**
 * Loads everything the pricing engine needs from the database (doc/03 §1).
 * The client only ever sends choices — address, payment mode, wallet on or
 * off, coupon code — never amounts.
 */

export type CheckoutChoices = {
  addressId: string
  paymentMode: PaymentModeInput
  useWallet: boolean
  couponCode?: string | null
}

export type StoreSettings = {
  freeShippingThresholdPaise: number
  partialCodEnabled: boolean
  codAdvanceType: "fixed" | "percent"
  codAdvanceValue: number
  codMaxOrderPaise: number
  codFeePaise: number
  reservationTtlMinutes: number
  registeredStateCode: string
  internationalCountryCodes: string[]
}

export type CheckoutContext = {
  quote: Quote
  hash: string
  address: ShippingAddressSnapshot
  coupon: PricingCoupon | null
  couponError: string | null
  walletBalancePaise: number
  codAvailable: boolean
  codReason: string | null
  settings: StoreSettings
  customer: { name: string; email: string | null; phone: string | null }
}

// Packaging added to every parcel's weight.
const PACKAGING_GRAMS = 150

export async function loadStoreSettings(): Promise<StoreSettings> {
  const result = await getDb().execute<{
    free_shipping_threshold_paise: number
    partial_cod_enabled: boolean
    cod_advance_type: "fixed" | "percent"
    cod_advance_value: number
    cod_max_order_paise: number
    cod_fee_paise: number
    reservation_ttl_minutes: number
    registered_state_code: string
    international_country_codes: string[]
  }>(sql`select * from store_settings where id = 1`)
  const row = result.rows[0]
  if (!row) throw new Error("store_settings row missing (run the migrations)")
  return {
    freeShippingThresholdPaise: row.free_shipping_threshold_paise,
    partialCodEnabled: row.partial_cod_enabled,
    codAdvanceType: row.cod_advance_type,
    codAdvanceValue: row.cod_advance_value,
    codMaxOrderPaise: row.cod_max_order_paise,
    codFeePaise: row.cod_fee_paise,
    reservationTtlMinutes: row.reservation_ttl_minutes,
    registeredStateCode: row.registered_state_code,
    internationalCountryCodes: row.international_country_codes,
  }
}

async function loadTaxRules(): Promise<TaxRule[]> {
  const result = await getDb().execute<{
    hsn_prefix: string
    price_threshold_paise: number | null
    rate_below_bp: number
    rate_above_bp: number
  }>(sql`
    select hsn_prefix, price_threshold_paise, rate_below_bp, rate_above_bp from tax_rules
    where effective_from <= (now() at time zone 'Asia/Kolkata')::date
      and (effective_to is null or effective_to >= (now() at time zone 'Asia/Kolkata')::date)`)
  return result.rows.map((r) => ({
    hsnPrefix: r.hsn_prefix,
    priceThresholdPaise: r.price_threshold_paise,
    rateBelowBp: r.rate_below_bp,
    rateAboveBp: r.rate_above_bp,
  }))
}

type CartLineRow = {
  variant_id: string
  product_id: string
  sku: string
  title: string
  variant_label: string | null
  image_key: string | null
  hsn_code: string
  price_paise: number
  mrp_paise: number
  quantity: number
  weight_grams: number
  purchasable: boolean
  available: number
  category_ids: string[] | null
  collection_ids: string[] | null
}

/** The signed-in customer's bag, priced from live variant data. */
async function loadCartLines(
  userId: string,
): Promise<{ lines: PricingLine[]; weightGrams: number; problems: string[] }> {
  const result = await getDb().execute<CartLineRow>(sql`
    select ci.variant_id, p.id as product_id, v.sku::text as sku, p.title, ci.quantity,
           v.price_paise, v.mrp_paise, p.hsn_code,
           coalesce(v.weight_grams_override, p.weight_grams) as weight_grams,
           (v.status = 'active' and p.status = 'active') as purchasable,
           coalesce((select sum(l.on_hand - l.reserved) from inventory_levels l
                     join stock_locations loc on loc.id = l.location_id and loc.is_active
                     where l.variant_id = v.id), 0)::int as available,
           (select string_agg(av.label, ' / ' order by pa.position, a.code)
            from variant_attribute_values vav
            join attributes a on a.id = vav.attribute_id
            join attribute_values av on av.id = vav.attribute_value_id
            left join product_attributes pa on pa.product_id = p.id and pa.attribute_id = a.id
            where vav.variant_id = v.id) as variant_label,
           (select m.storage_key from product_media pm
            join media_assets m on m.id = pm.media_id and m.deleted_at is null
            where pm.product_id = p.id
              and (pm.color_value_id is null or pm.color_value_id in
                   (select attribute_value_id from variant_attribute_values where variant_id = v.id))
            order by (pm.color_value_id is null), pm.position limit 1) as image_key,
           (select array_agg(distinct anc.id) from product_categories pc
            join categories own on own.id = pc.category_id
            join categories anc on own.path <@ anc.path
            where pc.product_id = p.id) as category_ids,
           (select array_agg(cp.collection_id) from collection_products cp where cp.product_id = p.id) as collection_ids
    from carts c
    join cart_items ci on ci.cart_id = c.id
    join product_variants v on v.id = ci.variant_id
    join products p on p.id = v.product_id
    where c.user_id = ${userId} and c.status = 'active'
    order by ci.created_at, ci.variant_id`)

  const problems: string[] = []
  const lines = result.rows.map((row, position): PricingLine => {
    if (!row.purchasable) problems.push(`${row.title} is no longer available.`)
    else if (row.available < row.quantity) {
      problems.push(
        row.available <= 0
          ? `${row.title} (${row.variant_label}) is sold out.`
          : `Only ${row.available} left of ${row.title} (${row.variant_label}).`,
      )
    }
    return {
      position,
      variantId: row.variant_id,
      productId: row.product_id,
      sku: row.sku,
      title: row.title,
      variantLabel: row.variant_label ?? "",
      imageKey: row.image_key,
      hsnCode: row.hsn_code,
      unitPricePaise: row.price_paise,
      unitMrpPaise: row.mrp_paise,
      quantity: row.quantity,
      categoryIds: row.category_ids ?? [],
      collectionIds: row.collection_ids ?? [],
    }
  })
  const weightGrams = result.rows.reduce(
    (sum, r) => sum + r.weight_grams * r.quantity,
    PACKAGING_GRAMS,
  )
  return { lines, weightGrams, problems }
}

async function loadAddress(
  userId: string,
  addressId: string,
): Promise<ShippingAddressSnapshot> {
  const result = await getDb().execute<{
    full_name: string
    phone: string
    line1: string
    line2: string | null
    landmark: string | null
    city: string
    region: string | null
    state_code: string | null
    postal_code: string
    country_code: string
  }>(
    sql`select * from addresses where id = ${addressId} and user_id = ${userId}`,
  )
  const a = result.rows[0]
  if (!a) throw new DomainError("NOT_FOUND", "Choose a delivery address.")
  return {
    fullName: a.full_name,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2,
    landmark: a.landmark,
    city: a.city,
    region: a.region,
    stateCode: a.state_code,
    postalCode: a.postal_code,
    countryCode: a.country_code,
  }
}

export function hashQuote(q: Quote): string {
  return createHash("sha256")
    .update(quoteFingerprint(q))
    .digest("hex")
    .slice(0, 32)
}

export async function buildCheckoutContext(
  actor: UserActor,
  choices: CheckoutChoices,
): Promise<CheckoutContext> {
  const db = getDb()
  const [
    settings,
    taxRules,
    automaticDiscounts,
    cart,
    address,
    walletBalancePaise,
    profile,
  ] = await Promise.all([
    loadStoreSettings(),
    loadTaxRules(),
    loadAutomaticDiscounts(db),
    loadCartLines(actor.userId),
    loadAddress(actor.userId, choices.addressId),
    spendableBalance(db, actor.userId),
    db.execute<{
      name: string
      email: string
      phone_number: string | null
      phone_verified: boolean | null
      cod_blocked: boolean | null
    }>(sql`
      select u.name, u.email, u.phone_number, u.phone_number_verified as phone_verified, cp.cod_blocked
      from users u left join customer_profiles cp on cp.user_id = u.id where u.id = ${actor.userId}`),
  ])
  const customer = profile.rows[0]!

  // Coupon: validated for this customer here; the engine checks the cart rules.
  let coupon: PricingCoupon | null = null
  let couponError: string | null = null
  if (choices.couponCode?.trim()) {
    const found = await findUsableCoupon(db, choices.couponCode, actor.userId)
    if ("coupon" in found) coupon = found.coupon
    else couponError = found.error
  }

  const domestic = address.countryCode === "IN"
  const extraIssues: QuoteIssue[] = []
  if (
    !domestic &&
    !settings.internationalCountryCodes.includes(address.countryCode)
  ) {
    extraIssues.push({
      code: "DELIVERY_UNAVAILABLE",
      message: "We don't ship to this country yet.",
      blocking: true,
    })
  }
  for (const problem of cart.problems) {
    extraIssues.push({ code: "UNAVAILABLE", message: problem, blocking: true })
  }

  // Partial COD eligibility (doc/03 §4): India, courier COD, verified phone, not blocked.
  let codReason: string | null = null
  if (!settings.partialCodEnabled)
    codReason = "Cash on delivery is currently unavailable."
  else if (!domestic) codReason = "Cash on delivery is available in India only."
  else if (customer.cod_blocked)
    codReason = "Cash on delivery isn't available on your account."
  else if (!customer.phone_verified)
    codReason = "Sign in with your mobile number to use cash on delivery."
  else {
    const service = await checkServiceability(actor, {
      pincode: address.postalCode,
    })
    if (!service.codAvailable)
      codReason = "Cash on delivery isn't available for this PIN code."
  }
  // An unavailable COD request stays as asked: the engine reports why.
  const paymentMode = choices.paymentMode

  const ratePaise = cart.lines.length
    ? await getShippingProvider().quoteRate({
        countryCode: address.countryCode,
        pincode: domestic ? address.postalCode : null,
        weightGrams: cart.weightGrams,
        cod: paymentMode === "partial_cod",
      })
    : null

  const q = priceQuote({
    lines: cart.lines,
    automaticDiscounts,
    coupon,
    destination: {
      countryCode: address.countryCode,
      stateCode: address.stateCode ?? null,
    },
    registeredStateCode: settings.registeredStateCode,
    shipping: {
      freeThresholdPaise: settings.freeShippingThresholdPaise,
      ratePaise,
    },
    paymentMode,
    cod: {
      eligible: codReason === null,
      ineligibleReason: codReason ?? undefined,
      advanceType: settings.codAdvanceType,
      advanceValue: settings.codAdvanceValue,
      feePaise: settings.codFeePaise,
      maxOrderPaise: settings.codMaxOrderPaise,
    },
    wallet: {
      balancePaise: walletBalancePaise,
      requestedPaise: choices.useWallet ? walletBalancePaise : 0,
    },
    taxRules,
  })
  q.issues.push(...extraIssues)
  if (couponError) {
    q.issues.push({
      code: "COUPON_NOT_APPLICABLE",
      message: couponError,
      blocking: false,
    })
  }

  return {
    quote: q,
    hash: hashQuote(q),
    address,
    coupon: q.couponCode ? coupon : null,
    couponError,
    walletBalancePaise,
    codAvailable: codReason === null,
    codReason,
    settings,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone_number,
    },
  }
}

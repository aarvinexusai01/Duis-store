import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { expect } from "vitest"

import { addCartItem } from "@/features/cart"
import {
  getCheckoutQuote,
  placeOrder,
  simulatePayment,
  verifyPayment,
  type PlaceResult,
} from "@/features/checkout"
import { adjustStock } from "@/features/inventory"
import { getDb } from "@/server/db/client"
import { brokenInvariants } from "@/server/db/invariants"
import { isDomainError } from "@/server/errors"

import { asSystem } from "../../helpers/actors"
import { buyer, code, sellableProduct, type Buyer } from "../../helpers/shop"

/**
 * Race-condition tests (doc/06 Phase 7, race campaign). Each scenario runs
 * RUNS times with fresh fixtures, starts its competing calls together on
 * separate database connections, and then checks the invariants in SQL, not
 * only the responses.
 */

export const RUNS = 3

export { buyer, code, type Buyer }

/**
 * Starts every task before awaiting any, so they compete for the same rows
 * (the pool gives each its own connection). Returns each outcome as "ok" or
 * the error code. A transaction Postgres aborted over a lock conflict (which
 * withTransaction reports as a generic CONFLICT) is "LOCK_CONFLICT", so a
 * deadlock never passes for an expected outcome.
 */
export async function race(
  tasks: (() => Promise<unknown>)[],
): Promise<string[]> {
  return Promise.all(
    tasks.map(async (task) => {
      try {
        await task()
        return "ok"
      } catch (error) {
        if (
          isDomainError(error) &&
          error.message.startsWith("Someone else changed this")
        )
          return "LOCK_CONFLICT"
        return isDomainError(error) ? error.code : String(error)
      }
    }),
  )
}

export const count = (outcomes: string[], value: string) =>
  outcomes.filter((o) => o === value).length

/**
 * A new published product with no stock, renamed so the many race fixtures
 * don't crowd other files' search tests (they all start as "Midnight Tee").
 */
export async function raceProduct() {
  const product = await sellableProduct(0)
  await getDb().execute(
    sql`update products set title = ${`Race fixture ${product.productId.slice(-8)}`},
          search_keywords = '' where id = ${product.productId}`,
  )
  return product
}

/** A new product whose first variant has exactly `units` in stock. */
export async function variantWithStock(units: number): Promise<string> {
  const { variantId } = await raceProduct()
  if (units > 0) {
    await adjustStock(asSystem(), {
      variantId,
      delta: units,
      reason: "receive",
    })
  }
  return variantId
}

export async function stockOf(variantId: string) {
  const { rows } = await getDb().execute<{
    on_hand: number
    reserved: number
  }>(
    sql`select on_hand, reserved from inventory_levels where variant_id = ${variantId}`,
  )
  return rows[0]!
}

export type Prepared = {
  customer: Buyer
  place: () => Promise<PlaceResult>
}

/**
 * Puts the items in the customer's bag and gets a quote, so the race itself
 * is only the "Place order" call.
 */
export async function prepareOrder(
  customer: Buyer,
  variantId: string,
  options: {
    quantity?: number
    couponCode?: string
    useWallet?: boolean
  } = {},
): Promise<Prepared> {
  await addCartItem(customer, {
    variantId,
    quantity: options.quantity ?? 1,
  })
  const choices = {
    addressId: customer.addressId,
    paymentMode: "prepaid" as const,
    useWallet: options.useWallet ?? false,
    couponCode: options.couponCode,
  }
  const view = await getCheckoutQuote(customer, choices)
  return {
    customer,
    place: () =>
      placeOrder(customer, {
        ...choices,
        quoteHash: view.hash,
        idempotencyKey: randomUUID(),
      }),
  }
}

export async function newCustomers(n: number): Promise<Buyer[]> {
  return Promise.all(Array.from({ length: n }, () => buyer()))
}

/** Pays an order on the fake gateway; returns the browser callback's input. */
export async function capture(customer: Buyer, result: PlaceResult) {
  if (result.status !== "pay") throw new Error("nothing to pay")
  const { paymentId, signature } = await simulatePayment(customer, {
    orderNumber: result.orderNumber,
    providerOrderId: result.payment.providerOrderId,
    outcome: "captured",
  })
  return {
    orderNumber: result.orderNumber,
    providerOrderId: result.payment.providerOrderId,
    providerPaymentId: paymentId,
    signature,
    amountPaise: result.payment.amountPaise,
  }
}

export function callback(
  customer: Buyer,
  paid: Awaited<ReturnType<typeof capture>>,
) {
  return verifyPayment(customer, {
    orderNumber: paid.orderNumber,
    providerOrderId: paid.providerOrderId,
    providerPaymentId: paid.providerPaymentId,
    signature: paid.signature,
  })
}

export async function orderByNumber(orderNumber: string) {
  const { rows } = await getDb().execute<{
    id: string
    status: string
    payment_status: string
    total_paise: number
    online_amount_paise: number
    wallet_applied_paise: number
  }>(sql`select id, status, payment_status, total_paise, online_amount_paise, wallet_applied_paise
         from orders where order_number = ${orderNumber}`)
  return rows[0]!
}

/** Whole-database invariants (src/server/db/invariants.ts) must all hold. */
export async function expectInvariants(): Promise<void> {
  expect(await brokenInvariants(), "broken invariants").toEqual([])
}

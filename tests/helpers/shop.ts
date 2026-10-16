import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"

import { addCartItem } from "@/features/cart"
import { publishProduct, setProductMedia } from "@/features/catalog"
import {
  getCheckoutQuote,
  placeOrder,
  simulatePayment,
  verifyPayment,
} from "@/features/checkout"
import { saveAddress } from "@/features/customers"
import { adjustStock } from "@/features/inventory"
import { uploadImage } from "@/features/media"
import type { UserActor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { isDomainError } from "@/server/errors"

import { asSystem, createUserActor } from "./actors"
import { createProductFixture } from "./catalog"
import { makeUniqueImage } from "./images"

/** A published product with stock, ready to sell (one fixture per test file). */
export async function sellableProduct(stockEach = 100) {
  const fx = await createProductFixture()
  const image = await uploadImage(asSystem(), {
    bytes: await makeUniqueImage(),
  })
  await setProductMedia(asSystem(), {
    productId: fx.productId,
    items: [{ mediaId: image.id, colorValueId: fx.black }],
  })
  await publishProduct(asSystem(), { id: fx.productId })
  const { rows } = await getDb().execute<{ id: string }>(sql`
    select id from product_variants where product_id = ${fx.productId} order by option_signature`)
  for (const { id } of rows) {
    await adjustStock(asSystem(), {
      variantId: id,
      delta: stockEach,
      reason: "receive",
    })
  }
  return { ...fx, variantId: rows[0]!.id }
}

export type Buyer = UserActor & { addressId: string }

export async function buyer(
  address: { postalCode?: string; stateCode?: string } = {},
): Promise<Buyer> {
  const actor = (await createUserActor("customer")) as UserActor
  // A verified mobile, which cash on delivery requires.
  await getDb().execute(sql`
    update users set phone_number = ${`+919${String(Math.random()).slice(2, 11)}`}, phone_number_verified = true
    where id = ${actor.userId}`)
  const { id } = await saveAddress(actor, {
    fullName: "Test Buyer",
    phone: "9876543210",
    line1: "1 Hazratganj",
    city: "Lucknow",
    stateCode: address.stateCode ?? "IN-UP",
    postalCode: address.postalCode ?? "226001",
    countryCode: "IN",
  })
  return { ...actor, addressId: id }
}

/** Puts items in the bag, places the order and pays (simulated gateway). */
export async function paidOrder(
  customer: Buyer,
  variantId: string,
  options: {
    quantity?: number
    paymentMode?: "prepaid" | "partial_cod"
    couponCode?: string
  } = {},
): Promise<string> {
  await addCartItem(customer, {
    variantId,
    quantity: options.quantity ?? 1,
  })
  const choices = {
    addressId: customer.addressId,
    paymentMode: options.paymentMode ?? "prepaid",
    useWallet: false,
    couponCode: options.couponCode,
  } as const
  const view = await getCheckoutQuote(customer, choices)
  const result = await placeOrder(customer, {
    ...choices,
    quoteHash: view.hash,
    idempotencyKey: randomUUID(),
  })
  if (result.status !== "pay") return result.orderNumber
  const { paymentId, signature } = await simulatePayment(customer, {
    orderNumber: result.orderNumber,
    providerOrderId: result.payment.providerOrderId,
    outcome: "captured",
  })
  await verifyPayment(customer, {
    orderNumber: result.orderNumber,
    providerOrderId: result.payment.providerOrderId,
    providerPaymentId: paymentId,
    signature,
  })
  return result.orderNumber
}

/** The error code an operation fails with, or "ok". */
export async function code(work: Promise<unknown>): Promise<string> {
  try {
    await work
    return "ok"
  } catch (error) {
    return isDomainError(error) ? error.code : String(error)
  }
}

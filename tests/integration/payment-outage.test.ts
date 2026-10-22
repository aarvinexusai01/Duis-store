import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { addCartItem } from "@/features/cart"
import { getCheckoutQuote, placeOrder, startPayment } from "@/features/checkout"
import { getDb } from "@/server/db/client"
import { isDomainError } from "@/server/errors"

import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { newCustomers, variantWithStock } from "./races/support"

/**
 * Razorpay down or unreachable (doc/06 Phase 8 audit): the customer gets a
 * clear message, the order and its stock are kept, and Pay works again once
 * the provider is back.
 */

const gatewayDown = vi.hoisted(() => ({ value: false }))

vi.mock("@/features/payments/gateway", async (original) => {
  const actual = await original<typeof import("@/features/payments/gateway")>()
  return {
    ...actual,
    getPaymentGateway: () => {
      const real = actual.getPaymentGateway()
      return {
        ...real,
        createOrder: (input: Parameters<typeof real.createOrder>[0]) => {
          if (gatewayDown.value)
            throw new actual.GatewayError("connect ETIMEDOUT", 0)
          return real.createOrder(input)
        },
      }
    },
  }
})

closeConnectionsAfterAll()

let variantId: string
beforeAll(async () => {
  variantId = await variantWithStock(10)
})

describe("the payment provider is down", () => {
  it("says so, keeps the order and stock, and lets the customer pay later", async () => {
    const [customer] = await newCustomers(1)
    await addCartItem(customer!, { variantId, quantity: 1 })
    const choices = {
      addressId: customer!.addressId,
      paymentMode: "prepaid" as const,
      useWallet: false,
    }
    const view = await getCheckoutQuote(customer!, choices)

    gatewayDown.value = true
    const failure = await placeOrder(customer!, {
      ...choices,
      quoteHash: view.hash,
      idempotencyKey: randomUUID(),
    }).catch((error: unknown) => error)
    expect(isDomainError(failure) && failure.code).toBe("PAYMENT_UNAVAILABLE")
    expect((failure as Error).message).toMatch(/held for 15 minutes/)

    const held = await getDb().execute<{
      order_number: string
      status: string
      reserved: number
    }>(sql`
      select o.order_number, o.status,
        (select reserved from inventory_levels where variant_id = ${variantId}) as reserved
      from orders o where o.user_id = ${customer!.userId}`)
    expect(held.rows).toHaveLength(1)
    expect(held.rows[0]).toMatchObject({
      status: "pending_payment",
      reserved: 1,
    })

    // Back up: pressing Pay again gets a payment for the same order.
    gatewayDown.value = false
    const retry = await startPayment(customer!, {
      orderNumber: held.rows[0]!.order_number,
    })
    expect(retry.providerOrderId).toMatch(/^fake_order_/)
  })
})

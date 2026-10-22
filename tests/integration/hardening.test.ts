import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { addCartItem } from "@/features/cart"
import { updateCategory } from "@/features/catalog"
import {
  getCheckoutQuote,
  placeOrder,
  type PlaceResult,
} from "@/features/checkout"
import {
  createCollection,
  refreshAutomaticCollections,
  setCollectionProducts,
  updateCollection,
} from "@/features/collections"
import { createDiscount, updateDiscount } from "@/features/discounts"
import { getDb } from "@/server/db/client"
import { hitLimit } from "@/server/security/shared-rate-limit"

import { asSystem, createUserActor, unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { createProductFixture } from "../helpers/catalog"
import {
  callback,
  capture,
  count,
  newCustomers,
  race,
  variantWithStock,
  type Buyer,
} from "./races/support"

/**
 * The fixes from the production-readiness audit (doc/06 Phase 8): the cap on
 * unpaid orders, shared rate limits, and stale-save protection for
 * categories, collections and discounts.
 */

closeConnectionsAfterAll()

const db = () => getDb()
let variantId: string
beforeAll(async () => {
  variantId = await variantWithStock(500)
})

async function placeFor(customer: Buyer): Promise<PlaceResult> {
  const choices = {
    addressId: customer.addressId,
    paymentMode: "prepaid" as const,
    useWallet: false,
  }
  const view = await getCheckoutQuote(customer, choices)
  return placeOrder(customer, {
    ...choices,
    quoteHash: view.hash,
    idempotencyKey: randomUUID(),
  })
}

describe("unpaid orders hold stock, so each customer may have two", () => {
  it("refuses a third unpaid order, and allows it once one is paid", async () => {
    const [customer] = await newCustomers(1)
    await addCartItem(customer!, { variantId, quantity: 1 })
    const first = await placeFor(customer!)
    await placeFor(customer!)
    const third = await race([() => placeFor(customer!)])
    expect(third).toEqual(["CONFLICT"])

    await callback(customer!, await capture(customer!, first))
    await addCartItem(customer!, { variantId, quantity: 1 })
    expect(await race([() => placeFor(customer!)])).toEqual(["ok"])
  })

  it("holds when the same customer places three at the same moment", async () => {
    const [customer] = await newCustomers(1)
    await addCartItem(customer!, { variantId, quantity: 1 })
    const outcomes = await race([
      () => placeFor(customer!),
      () => placeFor(customer!),
      () => placeFor(customer!),
    ])
    expect(count(outcomes, "ok")).toBe(2)
    expect(count(outcomes, "CONFLICT")).toBe(1)
    const open = await db().execute<{ n: number }>(sql`
      select count(*)::int as n from orders where user_id = ${customer!.userId} and status = 'pending_payment'`)
    expect(open.rows[0]!.n).toBe(2)
  })
})

describe("rate limits shared by both app copies", () => {
  it("lets exactly the limit through when requests arrive together", async () => {
    const key = `test:${randomUUID()}`
    const allowed = await Promise.all(
      Array.from({ length: 20 }, () =>
        hitLimit(key, { limit: 7, windowMs: 60_000 }),
      ),
    )
    expect(allowed.filter(Boolean)).toHaveLength(7)
  })

  it("starts a new window once the old one has passed", async () => {
    const key = `test:${randomUUID()}`
    const limit = { limit: 1, windowMs: 60_000 }
    expect(await hitLimit(key, limit)).toBe(true)
    expect(await hitLimit(key, limit)).toBe(false)
    await db().execute(
      sql`update app_rate_limits set window_start = now() - interval '2 minutes' where key = ${key}`,
    )
    expect(await hitLimit(key, limit)).toBe(true)
  })

  it("stops order placement after five attempts in ten minutes", async () => {
    const [customer] = await newCustomers(1)
    await addCartItem(customer!, { variantId, quantity: 1 })
    const outcomes: string[] = []
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(...(await race([() => placeFor(customer!)])))
    }
    // Two unpaid orders, three refused by the cap, then the limit.
    expect(outcomes).toEqual([
      "ok",
      "ok",
      "CONFLICT",
      "CONFLICT",
      "CONFLICT",
      "RATE_LIMITED",
    ])
  })

  it("stops coupon guessing after ten wrong codes in a minute", async () => {
    const [customer] = await newCustomers(1)
    await addCartItem(customer!, { variantId, quantity: 1 })
    const quote = (couponCode: string) => () =>
      getCheckoutQuote(customer!, {
        addressId: customer!.addressId,
        paymentMode: "prepaid",
        useWallet: false,
        couponCode,
      })
    for (let i = 0; i < 10; i += 1) {
      expect(await race([quote(`GUESS${i}X`)])).toEqual(["ok"])
    }
    const code = unique("REAL").replace(/-/g, "").toUpperCase()
    await createDiscount(asSystem(), {
      name: code,
      kind: "coupon",
      code,
      valueType: "fixed",
      value: 5_000,
    })
    expect(await race([quote(code)])).toEqual(["RATE_LIMITED"])
    // Checkout without a code still works.
    expect(
      await race([
        () =>
          getCheckoutQuote(customer!, {
            addressId: customer!.addressId,
            paymentMode: "prepaid",
            useWallet: false,
          }),
      ]),
    ).toEqual(["ok"])
  })
})

describe("two staff editing the same record", () => {
  async function versionOf(table: string, id: string): Promise<string> {
    const { rows } = await db().execute<{ updated_at: Date }>(
      sql`select updated_at from ${sql.identifier(table)} where id = ${id}`,
    )
    return new Date(rows[0]!.updated_at).toISOString()
  }

  it("refuses a stale category save", async () => {
    const admin = await createUserActor("store_admin")
    const fx = await createProductFixture()
    const { rows } = await db().execute<{ category_id: string }>(sql`
      select category_id from product_categories where product_id = ${fx.productId} limit 1`)
    const id = rows[0]!.category_id
    const opened = await versionOf("categories", id)
    const outcomes = await race([
      () =>
        updateCategory(admin, { id, name: "From A", expectedVersion: opened }),
      () =>
        updateCategory(admin, { id, name: "From B", expectedVersion: opened }),
    ])
    expect(outcomes.toSorted()).toEqual(["CONFLICT", "ok"])
  })

  it("keeps one version across a collection's details, rules and products", async () => {
    const admin = await createUserActor("store_admin")
    const product = await createProductFixture()
    const { id } = await createCollection(admin, {
      type: "manual",
      slug: unique("picks"),
      title: "Picks",
    })
    const opened = await versionOf("collections", id)
    // One editor saves the product list…
    await setCollectionProducts(admin, {
      collectionId: id,
      productIds: [product.productId],
      expectedVersion: opened,
    })
    // …so another's details form, opened earlier, is now stale.
    expect(
      await race([
        () =>
          updateCollection(admin, {
            id,
            title: "Stale",
            expectedVersion: opened,
          }),
      ]),
    ).toEqual(["CONFLICT"])
    // Reloaded, it saves.
    await updateCollection(admin, {
      id,
      title: "Fresh",
      expectedVersion: await versionOf("collections", id),
    })
  })

  it("doesn't count the automatic refresh as someone else's edit", async () => {
    const admin = await createUserActor("store_admin")
    const { id } = await createCollection(admin, {
      type: "automatic",
      slug: unique("auto"),
      title: "Auto",
      rules: [{ field: "price", operator: "lte", valuePaise: 100_000 }],
      ruleMatch: "all",
    })
    const opened = await versionOf("collections", id)
    await refreshAutomaticCollections(id)
    expect(await versionOf("collections", id)).toBe(opened)
    await updateCollection(admin, {
      id,
      title: "Still mine",
      expectedVersion: opened,
    })
  })

  it("refuses a stale discount save", async () => {
    const admin = await createUserActor("store_admin")
    const fields = {
      name: unique("Sale"),
      valueType: "percentage" as const,
      value: 1_000,
    }
    // A coupon, not an automatic discount: an automatic one would apply to
    // every later test's orders in this shared database.
    const { id } = await createDiscount(admin, {
      ...fields,
      kind: "coupon",
      code: unique("STALE").replace(/-/g, "").toUpperCase(),
    })
    const opened = await versionOf("discounts", id)
    const save = (name: string) => () =>
      updateDiscount(admin, {
        ...fields,
        name,
        id,
        maxDiscountPaise: null,
        minOrderPaise: 0,
        targets: [],
        eligibility: {},
        combinable: false,
        priority: 0,
        endsAt: null,
        usageLimitTotal: null,
        usageLimitPerCustomer: null,
        expectedVersion: opened,
      })
    const outcomes = await race([save("Sale A"), save("Sale B")])
    expect(outcomes.toSorted()).toEqual(["CONFLICT", "ok"])
  })
})

import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { describe, expect, it } from "vitest"

import * as schema from "@/db/schema"
import {
  inventoryLevels,
  inventoryMovements,
  inventoryReservations,
} from "@/db/schema"
import {
  adjustStock,
  commitReservations,
  expireReservations,
  getAvailability,
  releaseReservations,
  reserveStock,
} from "@/features/inventory"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"

import { asSystem } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"

closeConnectionsAfterAll()

const system = asSystem()

async function level(variantId: string) {
  const [row] = await getDb()
    .select({
      onHand: inventoryLevels.onHand,
      reserved: inventoryLevels.reserved,
    })
    .from(inventoryLevels)
    .where(eq(inventoryLevels.variantId, variantId))
  return row
}

describe("stock adjustments", () => {
  it("receives stock and records the movement", async () => {
    const { variants } = await createProductFixture()
    const variantId = variants[0]!.id
    const result = await adjustStock(system, {
      variantId,
      delta: 10,
      reason: "receive",
      note: "PO-1",
    })
    expect(result).toEqual({ onHand: 10, reserved: 0, available: 10 })

    const movements = await getDb()
      .select({
        delta: inventoryMovements.deltaOnHand,
        reason: inventoryMovements.reason,
      })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variantId))
    expect(movements).toEqual([{ delta: 10, reason: "receive" }])
  })

  it("never lets stock fall below what is reserved", async () => {
    const { variants } = await createProductFixture()
    const variantId = variants[0]!.id
    await adjustStock(system, { variantId, delta: 3, reason: "receive" })
    await withTransaction((tx) =>
      reserveStock(
        tx,
        { orderId: randomUUID() },
        [{ variantId, quantity: 2 }],
        15,
      ),
    )

    const error = await adjustStock(system, {
      variantId,
      delta: -2,
      reason: "damaged",
    }).catch((err) => err)
    expect(error).toMatchObject({ code: "INVALID_STATE" })
    expect(await level(variantId)).toEqual({ onHand: 3, reserved: 2 })
  })
})

describe("reservations", () => {
  it("sells the last unit to exactly one of 20 simultaneous buyers", async () => {
    const { variants } = await createProductFixture()
    const variantId = variants[0]!.id
    await adjustStock(system, { variantId, delta: 1, reason: "receive" })

    // Separate connections, like separate checkout requests.
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
    })
    const db = drizzle({ client: pool, schema, casing: "snake_case" })
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        db.transaction((tx) =>
          reserveStock(
            tx,
            { orderId: randomUUID() },
            [{ variantId, quantity: 1 }],
            15,
          ),
        ),
      ),
    )
    await pool.end()

    const won = attempts.filter((attempt) => attempt.status === "fulfilled")
    const lost = attempts.filter((attempt) => attempt.status === "rejected")
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(19)
    for (const attempt of lost) {
      expect((attempt as PromiseRejectedResult).reason).toMatchObject({
        code: "OUT_OF_STOCK",
      })
    }
    expect(await level(variantId)).toEqual({ onHand: 1, reserved: 1 })
  })

  it("reserves all lines or none", async () => {
    const { variants } = await createProductFixture()
    const [plenty, scarce] = [variants[0]!.id, variants[1]!.id]
    await adjustStock(system, {
      variantId: plenty,
      delta: 5,
      reason: "receive",
    })
    await adjustStock(system, {
      variantId: scarce,
      delta: 1,
      reason: "receive",
    })

    const error = await withTransaction((tx) =>
      reserveStock(
        tx,
        { orderId: randomUUID() },
        [
          { variantId: plenty, quantity: 2 },
          { variantId: scarce, quantity: 2 },
        ],
        15,
      ),
    ).catch((err) => err)
    expect(error).toMatchObject({
      code: "OUT_OF_STOCK",
      details: { variantIds: [scarce] },
    })
    expect(await level(plenty)).toEqual({ onHand: 5, reserved: 0 })
  })

  it("commits and releases idempotently", async () => {
    const { variants } = await createProductFixture()
    const variantId = variants[0]!.id
    await adjustStock(system, { variantId, delta: 4, reason: "receive" })
    const orderId = randomUUID()

    const [sold] = await withTransaction((tx) =>
      reserveStock(tx, { orderId }, [{ variantId, quantity: 3 }], 15),
    )
    const reference = { type: "order", id: orderId }
    expect(
      await withTransaction((tx) => commitReservations(tx, [sold!], reference)),
    ).toBe(1)
    expect(
      await withTransaction((tx) => commitReservations(tx, [sold!], reference)),
    ).toBe(0)
    expect(await level(variantId)).toEqual({ onHand: 1, reserved: 0 })

    const [held] = await withTransaction((tx) =>
      reserveStock(
        tx,
        { orderId: randomUUID() },
        [{ variantId, quantity: 1 }],
        15,
      ),
    )
    expect(
      await withTransaction((tx) => releaseReservations(tx, [held!])),
    ).toBe(1)
    expect(
      await withTransaction((tx) => releaseReservations(tx, [held!])),
    ).toBe(0)
    expect(await level(variantId)).toEqual({ onHand: 1, reserved: 0 })
  })

  it("expires reservations whose time ran out", async () => {
    const { variants } = await createProductFixture()
    const variantId = variants[0]!.id
    await adjustStock(system, { variantId, delta: 2, reason: "receive" })
    const [reservationId] = await withTransaction((tx) =>
      reserveStock(
        tx,
        { orderId: randomUUID() },
        [{ variantId, quantity: 2 }],
        -1,
      ),
    )

    expect(await expireReservations()).toBeGreaterThanOrEqual(1)
    const [row] = await getDb()
      .select({ status: inventoryReservations.status })
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.id, reservationId!)))
    expect(row!.status).toBe("expired")
    expect(await level(variantId)).toEqual({ onHand: 2, reserved: 0 })

    const availability = await getAvailability(system, {
      variantIds: [variantId],
    })
    expect(availability.get(variantId)).toBe(2)
  })
})

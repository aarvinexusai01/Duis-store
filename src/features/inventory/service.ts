import "server-only"
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm"

import {
  inventoryLevels,
  inventoryMovements,
  inventoryReservations,
  productVariants,
  stockLocations,
} from "@/db/schema"
import { refreshListingCache } from "@/features/catalog"
import { systemActor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"
import { uuidArray } from "@/server/db/sql"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import {
  adjustStockSchema,
  availabilitySchema,
  createStockLocationSchema,
  setLowStockThresholdSchema,
} from "./schemas"

/**
 * Inventory invariants (doc/03 §2):
 * - available = on_hand − reserved, enforced by inventory_levels' CHECK;
 * - every change is one conditional UPDATE, never read-then-write;
 * - every on_hand change writes an inventory_movements row;
 * - reservation state changes are idempotent.
 */

async function defaultLocationId(tx: Transaction): Promise<string> {
  const [location] = await tx
    .select({ id: stockLocations.id })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.isDefault, true),
        eq(stockLocations.isActive, true),
      ),
    )
  if (!location)
    throw new DomainError(
      "INVALID_STATE",
      "No default stock location is configured.",
    )
  return location.id
}

async function productIdsForVariants(
  tx: Transaction,
  variantIds: string[],
): Promise<string[]> {
  if (variantIds.length === 0) return []
  const rows = await tx
    .selectDistinct({ productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.id, variantIds))
  return rows.map((row) => row.productId)
}

/** Keeps listings in step with stock that crossed zero. */
async function stockChanged(tx: Transaction, variantIds: string[]) {
  const productIds = await productIdsForVariants(tx, variantIds)
  await refreshListingCache(tx, productIds)
  await requestRevalidation(
    [cacheTags.productsList, ...productIds.map(cacheTags.product)],
    { tx },
  )
}

export const createStockLocation = defineOperation({
  name: "inventory.createStockLocation",
  access: { inventory: ["adjust"] },
  input: createStockLocationSchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const [row] = await tx
        .insert(stockLocations)
        .values({ ...input, countryCode: "IN" })
        .returning({ id: stockLocations.id })
        .catch((err) => {
          if (isUniqueViolation(err, "stock_locations_one_default_idx")) {
            throw new DomainError(
              "CONFLICT",
              "There is already a default stock location.",
            )
          }
          if (isUniqueViolation(err))
            throw new DomainError("CONFLICT", "That location code is taken.")
          throw err
        })
      await writeAudit(tx, actor, {
        action: "stock_location.create",
        entityType: "stock_location",
        entityId: row!.id,
        changes: input,
      })
      return { id: row!.id }
    })
  },
})

/** Receive, correct or write off stock for one variant at one location. */
export const adjustStock = defineOperation({
  name: "inventory.adjustStock",
  access: { inventory: ["adjust"] },
  input: adjustStockSchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const locationId = input.locationId ?? (await defaultLocationId(tx))
      const [variant] = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.id, input.variantId))
      if (!variant) throw new DomainError("NOT_FOUND", "Variant not found.")

      await tx
        .insert(inventoryLevels)
        .values({ variantId: input.variantId, locationId })
        .onConflictDoNothing()

      // Conditional update: rejected if stock would drop below what is reserved.
      const [level] = await tx
        .update(inventoryLevels)
        .set({ onHand: sql`${inventoryLevels.onHand} + ${input.delta}` })
        .where(
          and(
            eq(inventoryLevels.variantId, input.variantId),
            eq(inventoryLevels.locationId, locationId),
            sql`${inventoryLevels.onHand} + ${input.delta} >= ${inventoryLevels.reserved}`,
          ),
        )
        .returning({
          onHand: inventoryLevels.onHand,
          reserved: inventoryLevels.reserved,
        })
      if (!level) {
        throw new DomainError(
          "INVALID_STATE",
          "Stock cannot go below the quantity already reserved for orders.",
        )
      }

      await tx.insert(inventoryMovements).values({
        variantId: input.variantId,
        locationId,
        deltaOnHand: input.delta,
        reason: input.reason,
        note: input.note ?? null,
        actorUserId: actor.kind === "user" ? actor.userId : null,
      })
      await writeAudit(tx, actor, {
        action: "inventory.adjust",
        entityType: "product_variant",
        entityId: input.variantId,
        changes: {
          locationId,
          delta: input.delta,
          reason: input.reason,
          onHand: level.onHand,
        },
      })
      await stockChanged(tx, [input.variantId])
      return {
        onHand: level.onHand,
        reserved: level.reserved,
        available: level.onHand - level.reserved,
      }
    })
  },
})

export const setLowStockThreshold = defineOperation({
  name: "inventory.setLowStockThreshold",
  access: { inventory: ["adjust"] },
  input: setLowStockThresholdSchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const locationId = input.locationId ?? (await defaultLocationId(tx))
      await tx
        .insert(inventoryLevels)
        .values({
          variantId: input.variantId,
          locationId,
          lowStockThreshold: input.threshold,
        })
        .onConflictDoUpdate({
          target: [inventoryLevels.variantId, inventoryLevels.locationId],
          set: { lowStockThreshold: input.threshold },
        })
      await writeAudit(tx, actor, {
        action: "inventory.set_threshold",
        entityType: "product_variant",
        entityId: input.variantId,
        changes: { locationId, threshold: input.threshold },
      })
      return { threshold: input.threshold }
    })
  },
})

/** Live availability across active locations (never cached; doc/02 §5). */
export const getAvailability = defineOperation({
  name: "inventory.getAvailability",
  access: "public",
  input: availabilitySchema,
  async handler(_ctx, { variantIds }) {
    const result = await getDb().execute<{
      variant_id: string
      available: number
    }>(sql`
      select v.id as variant_id,
             coalesce(sum(l.on_hand - l.reserved) filter (where loc.is_active), 0)::int as available
      from product_variants v
      left join inventory_levels l on l.variant_id = v.id
      left join stock_locations loc on loc.id = l.location_id
      where v.id = any(${uuidArray(variantIds)})
      group by v.id
    `)
    return new Map(result.rows.map((row) => [row.variant_id, row.available]))
  },
})

// --- Reservations: called by checkout (Phase 3) and exchanges (Phase 5) -----

export type ReservationLine = { variantId: string; quantity: number }
export type ReservationHolder = { orderId: string } | { exchangeId: string }

/**
 * Reserves every line or nothing. Lines are locked in variant-id order so
 * concurrent checkouts cannot deadlock; each line is a single conditional
 * UPDATE, so two buyers can never both get the last unit.
 */
export async function reserveStock(
  tx: Transaction,
  holder: ReservationHolder,
  lines: ReservationLine[],
  ttlMinutes: number,
): Promise<string[]> {
  const quantities = new Map<string, number>()
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Quantities must be positive whole numbers.",
      )
    }
    quantities.set(
      line.variantId,
      (quantities.get(line.variantId) ?? 0) + line.quantity,
    )
  }

  const locationId = await defaultLocationId(tx)
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
  const reservationIds: string[] = []
  const unavailable: string[] = []

  for (const variantId of [...quantities.keys()].sort()) {
    const quantity = quantities.get(variantId)!
    const [level] = await tx
      .update(inventoryLevels)
      .set({ reserved: sql`${inventoryLevels.reserved} + ${quantity}` })
      .where(
        and(
          eq(inventoryLevels.variantId, variantId),
          eq(inventoryLevels.locationId, locationId),
          sql`${inventoryLevels.onHand} - ${inventoryLevels.reserved} >= ${quantity}`,
        ),
      )
      .returning({ variantId: inventoryLevels.variantId })
    if (!level) {
      unavailable.push(variantId)
      continue
    }
    const [reservation] = await tx
      .insert(inventoryReservations)
      .values({ variantId, locationId, quantity, expiresAt, ...holder })
      .returning({ id: inventoryReservations.id })
    reservationIds.push(reservation!.id)
  }

  if (unavailable.length > 0) {
    // Throwing rolls back the reservations made above.
    throw new DomainError(
      "OUT_OF_STOCK",
      "Some items are no longer available.",
      {
        variantIds: unavailable,
      },
    )
  }
  return reservationIds
}

/** Turns reservations into sales (order confirmed). Idempotent. */
export async function commitReservations(
  tx: Transaction,
  reservationIds: string[],
  reference: { type: string; id: string },
): Promise<number> {
  if (reservationIds.length === 0) return 0
  const committed = await tx
    .update(inventoryReservations)
    .set({ status: "committed" })
    .where(
      and(
        inArray(inventoryReservations.id, reservationIds),
        eq(inventoryReservations.status, "active"),
      ),
    )
    .returning({
      variantId: inventoryReservations.variantId,
      locationId: inventoryReservations.locationId,
      quantity: inventoryReservations.quantity,
    })

  for (const row of committed.sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  )) {
    await tx
      .update(inventoryLevels)
      .set({
        onHand: sql`${inventoryLevels.onHand} - ${row.quantity}`,
        reserved: sql`${inventoryLevels.reserved} - ${row.quantity}`,
      })
      .where(
        and(
          eq(inventoryLevels.variantId, row.variantId),
          eq(inventoryLevels.locationId, row.locationId),
        ),
      )
    await tx.insert(inventoryMovements).values({
      variantId: row.variantId,
      locationId: row.locationId,
      deltaOnHand: -row.quantity,
      reason: "sale",
      referenceType: reference.type,
      referenceId: reference.id,
    })
  }
  if (committed.length > 0)
    await stockChanged(
      tx,
      committed.map((row) => row.variantId),
    )
  return committed.length
}

/** Returns reserved stock (payment failed, cancelled or expired). Idempotent. */
export async function releaseReservations(
  tx: Transaction,
  reservationIds: string[],
  outcome: "released" | "expired" = "released",
): Promise<number> {
  if (reservationIds.length === 0) return 0
  const released = await tx
    .update(inventoryReservations)
    .set({ status: outcome })
    .where(
      and(
        inArray(inventoryReservations.id, reservationIds),
        eq(inventoryReservations.status, "active"),
      ),
    )
    .returning({
      variantId: inventoryReservations.variantId,
      locationId: inventoryReservations.locationId,
      quantity: inventoryReservations.quantity,
    })

  for (const row of released.sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  )) {
    await tx
      .update(inventoryLevels)
      .set({ reserved: sql`${inventoryLevels.reserved} - ${row.quantity}` })
      .where(
        and(
          eq(inventoryLevels.variantId, row.variantId),
          eq(inventoryLevels.locationId, row.locationId),
        ),
      )
  }
  if (released.length > 0)
    await stockChanged(
      tx,
      released.map((row) => row.variantId),
    )
  return released.length
}

/**
 * Puts committed stock back on the shelf (an order cancelled before
 * dispatch). Each reservation is restocked once: its status moves to
 * `released`, and the movement row records why.
 */
export async function restockCommitted(
  tx: Transaction,
  orderId: string,
  reason: "cancel_restock" | "rto_restock",
): Promise<number> {
  const restocked = await tx
    .update(inventoryReservations)
    .set({ status: "released" })
    .where(
      and(
        eq(inventoryReservations.orderId, orderId),
        eq(inventoryReservations.status, "committed"),
      ),
    )
    .returning({
      variantId: inventoryReservations.variantId,
      locationId: inventoryReservations.locationId,
      quantity: inventoryReservations.quantity,
    })
  for (const row of restocked.sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  )) {
    await tx
      .update(inventoryLevels)
      .set({ onHand: sql`${inventoryLevels.onHand} + ${row.quantity}` })
      .where(
        and(
          eq(inventoryLevels.variantId, row.variantId),
          eq(inventoryLevels.locationId, row.locationId),
        ),
      )
    await tx.insert(inventoryMovements).values({
      variantId: row.variantId,
      locationId: row.locationId,
      deltaOnHand: row.quantity,
      reason,
      referenceType: "order",
      referenceId: orderId,
    })
  }
  if (restocked.length > 0) {
    await stockChanged(
      tx,
      restocked.map((row) => row.variantId),
    )
  }
  return restocked.length
}

/**
 * inventory.expire-reservations job: releases reservations whose time ran out.
 * Order reservations are left to orders.expire-pending, which asks the
 * payment gateway first so a paid order is never expired. SKIP LOCKED lets
 * several workers run it without double-processing.
 */
export async function expireReservations(batchSize = 200): Promise<number> {
  return withTransaction(async (tx) => {
    const due = await tx
      .select({ id: inventoryReservations.id })
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.status, "active"),
          lt(inventoryReservations.expiresAt, new Date()),
          isNull(inventoryReservations.orderId),
        ),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true })
    const count = await releaseReservations(
      tx,
      due.map((row) => row.id),
      "expired",
    )
    if (count > 0) {
      await writeAudit(tx, systemActor("inventory.expire-reservations"), {
        action: "inventory.expire_reservations",
        entityType: "inventory_reservation",
        changes: { count },
      })
    }
    return count
  })
}

import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import {
  commitReservations,
  receiveReturnedStock,
  releaseReservations,
  reserveStock,
} from "@/features/inventory"
import { onExchangeDifferencePaid } from "@/features/orders"
import { getPaymentGateway, requestRefund } from "@/features/payments"
import {
  createShipmentRecord,
  onShipmentStatusChanged,
  scheduleShipmentRetry,
  type ShipmentStatusChange,
} from "@/features/shipping"
import { creditWallet } from "@/features/wallet"
import { formatPaise } from "@/lib/money"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import {
  lockExchange,
  notifyCustomer,
  parcelWeight,
  requireStatus,
  setStatus,
  type ExchangeRow,
  type ExchangeStatus,
} from "./core"

/**
 * Self-service exchanges (doc/03 §7, doc/10 P7–P10, I5): the same product in
 * another size or colour, within the window after delivery, up to the limit
 * per item, never for excluded categories or international orders. Pickup is
 * free; a price difference is paid online or credited to the wallet.
 */

const orderNumber = z.string().regex(/^DUIS-\d{6,}$/)
const exchangeNumber = z.string().regex(/^EX-\d{6,}$/)
const HOLD_MINUTES = 60 * 24 * 30
const userOf = (actor: Actor) => {
  if (actor.kind !== "user")
    throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
  return actor
}

export const REASON_LABEL: Record<string, string> = {
  too_small: "Too small",
  too_large: "Too large",
  colour: "Prefer another colour",
  damaged: "Arrived damaged",
  wrong_item: "Wrong item sent",
  other: "Something else",
}

export type ExchangeOption = {
  variantId: string
  label: string
  available: number
  pricePaise: number
  differencePerUnitPaise: number
}

export type ExchangeableItem = {
  orderItemId: string
  title: string
  variantLabel: string
  imageKey: string | null
  quantity: number
  unitPricePaise: number
  eligible: boolean
  why: string | null
  options: ExchangeOption[]
}

export type CustomerExchange = {
  exchangeNumber: string
  status: ExchangeStatus
  item: string
  replacement: string
  quantity: number
  reason: string
  priceDifferencePaise: number
  createdAt: Date
  decisionNote: string | null
  qcNote: string | null
  canCancel: boolean
  canPay: boolean
}

const VARIANT_LABEL = sql`(select string_agg(av.label, ' / ' order by pa.position)
  from variant_attribute_values vav
  join attribute_values av on av.id = vav.attribute_value_id
  left join product_attributes pa on pa.product_id = v.product_id and pa.attribute_id = vav.attribute_id
  where vav.variant_id = v.id)`

type OrderForExchange = {
  id: string
  order_number: string
  status: string
  is_export: boolean
  delivered_at: Date | null
  window_days: number
  max_per_item: number
}

async function ownOrder(
  db: Transaction | ReturnType<typeof getDb>,
  userId: string,
  number: string,
): Promise<OrderForExchange> {
  const found = await db.execute<OrderForExchange>(sql`
    select o.id, o.order_number, o.status, o.is_export,
      (select max(s.delivered_at) from shipments s
       where s.order_id = o.id and s.direction in ('forward', 'replacement') and s.status = 'delivered') as delivered_at,
      st.exchange_window_days as window_days, st.max_exchanges_per_item as max_per_item
    from orders o cross join store_settings st
    where st.id = 1 and o.order_number = ${number} and o.user_id = ${userId}`)
  const order = found.rows[0]
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.")
  return order
}

/** Why this order can't be exchanged at all, or null. */
function orderBlock(order: OrderForExchange): string | null {
  if (order.is_export)
    return "International orders can't be exchanged online. Contact us if an item arrived damaged or wrong."
  if (order.status !== "delivered" || !order.delivered_at)
    return "Exchanges open once your order is delivered."
  const closes =
    new Date(order.delivered_at).getTime() + order.window_days * 86_400_000
  if (Date.now() > closes)
    return `The ${order.window_days}-day exchange window has closed.`
  return null
}

async function loadItems(
  db: Transaction | ReturnType<typeof getDb>,
  order: OrderForExchange,
): Promise<ExchangeableItem[]> {
  const items = await db.execute<{
    id: string
    title: string
    variant_label: string
    image_key: string | null
    quantity: number
    unit_price_paise: number
    product_id: string | null
    variant_id: string | null
    excluded: boolean
    used: number
    open: number
  }>(sql`
    select oi.id, oi.title, oi.variant_label, oi.image_key, oi.quantity, oi.unit_price_paise,
           oi.product_id, oi.variant_id,
           exists (select 1 from product_categories pc join categories c on c.id = pc.category_id
                   where pc.product_id = oi.product_id and not c.exchange_allowed) as excluded,
           (select count(*)::int from exchange_requests e where e.order_item_id = oi.id
              and e.status not in ('rejected', 'cancelled', 'qc_failed')) as used,
           (select count(*)::int from exchange_requests e where e.order_item_id = oi.id
              and e.status not in ('rejected', 'cancelled', 'qc_failed', 'completed')) as open
    from order_items oi where oi.order_id = ${order.id} order by oi.position`)
  const block = orderBlock(order)
  const productIds = [
    ...new Set(items.rows.map((i) => i.product_id).filter(Boolean)),
  ] as string[]
  const variants = productIds.length
    ? await db.execute<{
        id: string
        product_id: string
        label: string | null
        sku: string
        price_paise: number
        available: number
      }>(sql`
        select v.id, v.product_id, ${VARIANT_LABEL} as label, v.sku::text as sku, v.price_paise,
               coalesce((select sum(l.on_hand - l.reserved) from inventory_levels l where l.variant_id = v.id), 0)::int as available
        from product_variants v join products p on p.id = v.product_id
        where v.product_id in (${sql.join(
          productIds.map((id) => sql`${id}`),
          sql`, `,
        )}) and v.status = 'active' and p.status = 'active'
        order by v.position`)
    : { rows: [] }
  return items.rows.map((item) => {
    const why =
      block ??
      (!item.product_id
        ? "This product is no longer sold."
        : item.excluded
          ? "This item can't be exchanged (hygiene)."
          : item.open > 0
            ? "An exchange for this item is already in progress."
            : item.used >= order.max_per_item
              ? `This item has been exchanged ${order.max_per_item} times already.`
              : null)
    return {
      orderItemId: item.id,
      title: item.title,
      variantLabel: item.variant_label,
      imageKey: item.image_key,
      quantity: item.quantity,
      unitPricePaise: item.unit_price_paise,
      eligible: why === null,
      why,
      options: variants.rows
        .filter((v) => v.product_id === item.product_id)
        .map((v) => ({
          variantId: v.id,
          label: v.label ?? v.sku,
          available: Math.max(0, v.available),
          pricePaise: v.price_paise,
          differencePerUnitPaise: v.price_paise - item.unit_price_paise,
        })),
    }
  })
}

export const getExchangeOptions = defineOperation({
  name: "exchanges.options",
  access: "authenticated",
  input: z.object({ orderNumber }),
  async handler({ actor }, input) {
    const user = userOf(actor)
    const db = getDb()
    const order = await ownOrder(db, user.userId, input.orderNumber)
    const [items, exchanges] = await Promise.all([
      loadItems(db, order),
      listForOrder(db, order.id),
    ])
    return { orderNumber: order.order_number, items, exchanges }
  },
})

async function listForOrder(
  db: Transaction | ReturnType<typeof getDb>,
  orderId: string,
): Promise<CustomerExchange[]> {
  const rows = await db.execute<{
    exchange_number: string
    status: ExchangeStatus
    title: string
    variant_label: string
    new_label: string | null
    quantity: number
    reason: string
    price_difference_paise: number
    created_at: Date
    decision_note: string | null
    qc_note: string | null
  }>(sql`
    select e.exchange_number, e.status, oi.title, oi.variant_label, ${VARIANT_LABEL} as new_label,
           e.quantity, e.reason, e.price_difference_paise, e.created_at, e.decision_note, e.qc_note
    from exchange_requests e
    join order_items oi on oi.id = e.order_item_id
    join product_variants v on v.id = e.requested_variant_id
    where e.order_id = ${orderId} order by e.created_at desc`)
  return rows.rows.map((r) => ({
    exchangeNumber: r.exchange_number,
    status: r.status,
    item: `${r.title} (${r.variant_label})`,
    replacement: r.new_label ?? "",
    quantity: r.quantity,
    reason: REASON_LABEL[r.reason] ?? r.reason,
    priceDifferencePaise: r.price_difference_paise,
    createdAt: new Date(r.created_at),
    decisionNote: r.decision_note,
    qcNote: r.qc_note,
    canCancel: ["requested", "awaiting_payment"].includes(r.status),
    canPay: r.status === "awaiting_payment",
  }))
}

export const requestExchange = defineOperation({
  name: "exchanges.request",
  access: "authenticated",
  input: z.object({
    orderNumber,
    orderItemId: z.uuid(),
    variantId: z.uuid(),
    quantity: z.number().int().min(1).max(10),
    reason: z.enum([
      "too_small",
      "too_large",
      "colour",
      "damaged",
      "wrong_item",
      "other",
    ]),
    note: z.string().trim().max(500).optional(),
    photoIds: z.array(z.uuid()).max(3).default([]),
  }),
  async handler({ actor }, input) {
    const user = userOf(actor)
    try {
      return await withTransaction(async (tx) => {
        const order = await ownOrder(tx, user.userId, input.orderNumber)
        const items = await loadItems(tx, order)
        const item = items.find((i) => i.orderItemId === input.orderItemId)
        if (!item) throw new DomainError("NOT_FOUND", "Item not found.")
        if (!item.eligible) throw new DomainError("INVALID_STATE", item.why!)
        if (input.quantity > item.quantity) {
          throw new DomainError(
            "VALIDATION_FAILED",
            `You bought ${item.quantity} of this.`,
            { issues: { quantity: [`At most ${item.quantity}.`] } },
          )
        }
        const option = item.options.find((o) => o.variantId === input.variantId)
        const original = await tx.execute<{ variant_id: string | null }>(
          sql`select variant_id from order_items where id = ${item.orderItemId}`,
        )
        const sameVariant = original.rows[0]?.variant_id === input.variantId
        // The same size and colour again only replaces a damaged or wrong item.
        if (
          !option ||
          (sameVariant && !["damaged", "wrong_item"].includes(input.reason))
        ) {
          throw new DomainError(
            "VALIDATION_FAILED",
            "Choose another size or colour of the same product.",
            { issues: { variantId: ["Choose a different option."] } },
          )
        }
        if (option.available < input.quantity) {
          throw new DomainError(
            "OUT_OF_STOCK",
            "That option doesn't have enough stock right now.",
          )
        }
        if (input.photoIds.length > 0) {
          const mine = await tx.execute<{ n: number }>(sql`
            select count(*)::int as n from customer_photos
            where user_id = ${user.userId} and id in (${sql.join(
              input.photoIds.map((id) => sql`${id}`),
              sql`, `,
            )})`)
          if (mine.rows[0]!.n !== input.photoIds.length)
            throw new DomainError("FORBIDDEN", "Unknown photo.")
        }
        const difference = sameVariant
          ? 0
          : option.differencePerUnitPaise * input.quantity
        const created = await tx.execute<{ id: string }>(sql`
          insert into exchange_requests (order_id, order_item_id, user_id, quantity, requested_variant_id,
                                         reason, customer_note, price_difference_paise)
          values (${order.id}, ${item.orderItemId}, ${user.userId}, ${input.quantity}, ${input.variantId},
                  ${input.reason}::exchange_reason, ${input.note ?? null}, ${difference})
          returning id`)
        const id = created.rows[0]!.id
        for (const photoId of input.photoIds) {
          await tx.execute(sql`
            insert into exchange_request_photos (exchange_id, photo_id) values (${id}, ${photoId})`)
        }
        const row = await lockExchange(tx, { id })
        await notifyCustomer(
          tx,
          row,
          "We've got your request",
          `We'll check it within a working day. ${
            difference > 0
              ? `The new option costs ${formatPaise(difference)} more; you'll pay that once we approve.`
              : difference < 0
                ? `It costs ${formatPaise(-difference)} less; we'll add that to your Duis wallet once we receive your item.`
                : "There's nothing extra to pay, and pickup is free."
          }`,
        )
        return { exchangeNumber: row.exchange_number }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(
          "CONFLICT",
          "An exchange for this item is already in progress.",
        )
      }
      throw error
    }
  },
})

async function ownExchange(tx: Transaction, userId: string, number: string) {
  const row = await lockExchange(tx, { number })
  if (row.user_id !== userId)
    throw new DomainError("NOT_FOUND", "Exchange not found.")
  return row
}

/** Ends an exchange before any parcel exists: frees the held stock and the usage. */
export async function closeBeforePickup(
  tx: Transaction,
  row: ExchangeRow,
  status: "rejected" | "cancelled",
  actor: Actor,
  note?: string,
) {
  // No parcel exists yet in these states, so nothing to cancel with a courier.
  requireStatus(
    row,
    ["requested", "awaiting_payment"],
    "This exchange can't be stopped any more: the pickup is being booked.",
  )
  const held = await tx.execute<{ id: string }>(sql`
    select id from inventory_reservations where exchange_id = ${row.id} and status = 'active'`)
  await releaseReservations(
    tx,
    held.rows.map((r) => r.id),
    "released",
  )
  if (row.status !== "requested") {
    await tx.execute(sql`
      update order_items set exchanged_quantity = greatest(exchanged_quantity - ${row.quantity}, 0)
      where id = ${row.order_item_id}`)
  }
  await setStatus(tx, row, status, { note, field: "decision", actor })
}

export const cancelMyExchange = defineOperation({
  name: "exchanges.cancel",
  access: "authenticated",
  input: z.object({ exchangeNumber }),
  async handler({ actor }, input) {
    const user = userOf(actor)
    return withTransaction(async (tx) => {
      const row = await ownExchange(tx, user.userId, input.exchangeNumber)
      requireStatus(
        row,
        ["requested", "awaiting_payment"],
        "This exchange is already approved. Contact us to stop it.",
      )
      await closeBeforePickup(tx, row, "cancelled", actor, "Cancelled by you")
      return {}
    })
  },
})

/**
 * Pay the price difference: one gateway order per exchange, reused for
 * retries. Verification uses the normal checkout callback.
 */
export const startExchangePayment = defineOperation({
  name: "exchanges.startPayment",
  access: "authenticated",
  input: z.object({ exchangeNumber }),
  async handler({ actor }, input) {
    const user = userOf(actor)
    const gateway = getPaymentGateway()
    return withTransaction(async (tx) => {
      const row = await ownExchange(tx, user.userId, input.exchangeNumber)
      requireStatus(
        row,
        ["awaiting_payment"],
        "There's nothing to pay for this exchange.",
      )
      let providerOrderId: string | null = null
      if (row.difference_payment_id) {
        const existing = await tx.execute<{ provider_order_id: string }>(sql`
          select provider_order_id from payments
          where id = ${row.difference_payment_id} and provider = ${gateway.name} and status in ('created', 'failed')`)
        providerOrderId = existing.rows[0]?.provider_order_id ?? null
      }
      if (!providerOrderId) {
        const order = await gateway.createOrder({
          amountPaise: row.price_difference_paise,
          receipt: row.exchange_number,
          notes: { exchange: row.exchange_number, order: row.order_number },
        })
        providerOrderId = order.id
        const payment = await tx.execute<{ id: string }>(sql`
          insert into payments (order_id, purpose, provider, provider_order_id, amount_paise)
          values (${row.order_id}, 'exchange_difference', ${gateway.name}, ${order.id}, ${row.price_difference_paise})
          returning id`)
        await tx.execute(sql`
          update exchange_requests set difference_payment_id = ${payment.rows[0]!.id} where id = ${row.id}`)
      }
      const contact = await tx.execute<{
        customer_email: string | null
        customer_phone: string | null
      }>(
        sql`select customer_email, customer_phone from orders where id = ${row.order_id}`,
      )
      const c = contact.rows[0]!
      return {
        provider: gateway.name,
        key: gateway.publicKey,
        providerOrderId,
        amountPaise: row.price_difference_paise,
        currency: "INR" as const,
        orderNumber: row.order_number,
        prefill: {
          name: row.customer_name,
          ...(c.customer_email && !c.customer_email.endsWith(".invalid")
            ? { email: c.customer_email }
            : {}),
          ...(c.customer_phone ? { contact: c.customer_phone } : {}),
        },
      }
    })
  },
})

// --- Steps shared by staff actions, payments and parcel events --------------

/** Books the free return pickup (the worker sends it to the courier). */
export async function createReturnParcel(
  tx: Transaction,
  row: ExchangeRow,
  actor: Actor,
): Promise<string> {
  const id = await createShipmentRecord(tx, {
    orderId: row.order_id,
    orderNumber: row.order_number,
    direction: "reverse",
    exchangeId: row.id,
    codAmountPaise: 0,
    weightGrams: await parcelWeight(tx, row),
    lengthCm: 30,
    breadthCm: 25,
    heightCm: 5,
    customs: null,
    items: [{ orderItemId: row.order_item_id, quantity: row.quantity }],
    createdBy: actor.kind === "user" ? actor.userId : null,
  })
  await scheduleShipmentRetry(id, { tx, now: true })
  return id
}

/** Approval: hold the replacement, then ask for payment or book the pickup. */
export async function approveInTransaction(
  tx: Transaction,
  row: ExchangeRow,
  actor: Actor,
  note?: string,
): Promise<string | null> {
  requireStatus(row, ["requested"], "Only new requests can be approved.")
  await reserveStock(
    tx,
    { exchangeId: row.id },
    [{ variantId: row.requested_variant_id, quantity: row.quantity }],
    HOLD_MINUTES,
  )
  await tx.execute(sql`
    update order_items set exchanged_quantity = exchanged_quantity + ${row.quantity}
    where id = ${row.order_item_id}`)
  if (row.price_difference_paise > 0) {
    await setStatus(tx, row, "awaiting_payment", {
      note,
      field: "decision",
      actor,
    })
    await notifyCustomer(
      tx,
      row,
      "Approved: please pay the difference",
      `Your exchange is approved and the new item is set aside for you. Pay ${formatPaise(row.price_difference_paise)} from your order page and we'll book a free pickup.`,
    )
    return null
  }
  await setStatus(tx, row, "approved", { note, field: "decision", actor })
  await notifyCustomer(
    tx,
    row,
    "Approved",
    "Your exchange is approved and the new item is set aside for you. We're booking a free pickup; the courier will contact you.",
  )
  return createReturnParcel(tx, row, actor)
}

onExchangeDifferencePaid(async (tx, paymentRowId, actor) => {
  const found = await tx.execute<{ id: string }>(
    sql`select id from exchange_requests where difference_payment_id = ${paymentRowId}`,
  )
  if (!found.rows[0]) return "refund"
  const row = await lockExchange(tx, { id: found.rows[0].id })
  if (row.status !== "awaiting_payment") return "refund"
  await setStatus(tx, row, "approved")
  await notifyCustomer(
    tx,
    row,
    "Payment received",
    "Thanks, we've received the difference. We're booking a free pickup; the courier will contact you.",
  )
  await createReturnParcel(tx, row, actor)
  return "confirmed"
})

/** QC passed: restock the returned item, credit any saving, send the new one. */
export async function passQcInTransaction(
  tx: Transaction,
  row: ExchangeRow,
  actor: Actor,
  note?: string,
): Promise<string> {
  requireStatus(
    row,
    ["received", "picked_up", "pickup_scheduled"],
    "The returned item hasn't arrived yet.",
  )
  if (row.original_variant_id) {
    await receiveReturnedStock(tx, {
      variantId: row.original_variant_id,
      quantity: row.quantity,
      reference: { type: "exchange", id: row.id },
    })
  }
  if (row.price_difference_paise < 0) {
    await creditWallet(tx, {
      userId: row.user_id,
      amountPaise: -row.price_difference_paise,
      reason: "exchange_credit",
      reference: { type: "exchange", id: row.id },
      idempotencyKey: `exchange:${row.id}:credit`,
      note: `Price difference for ${row.exchange_number}`,
    })
  }
  await setStatus(tx, row, "qc_passed", { note, field: "qc" })
  await notifyCustomer(
    tx,
    row,
    "We've received your item",
    `It passed our check, so your replacement is being packed${
      row.price_difference_paise < 0
        ? `, and ${formatPaise(-row.price_difference_paise)} is in your Duis wallet`
        : ""
    }.`,
  )
  const id = await createShipmentRecord(tx, {
    orderId: row.order_id,
    orderNumber: row.order_number,
    direction: "replacement",
    exchangeId: row.id,
    codAmountPaise: 0,
    weightGrams: await parcelWeight(tx, row),
    lengthCm: 30,
    breadthCm: 25,
    heightCm: 5,
    customs: null,
    items: [],
    createdBy: actor.kind === "user" ? actor.userId : null,
  })
  return id
}

/**
 * QC failed (owner decision 2026-10-16): the item goes back to the customer
 * at our cost; no replacement or credit; a paid difference is refunded.
 */
export async function failQcInTransaction(
  tx: Transaction,
  row: ExchangeRow,
  actor: Actor,
  note: string,
): Promise<string> {
  requireStatus(
    row,
    ["received", "picked_up", "pickup_scheduled"],
    "The returned item hasn't arrived yet.",
  )
  const held = await tx.execute<{ id: string }>(sql`
    select id from inventory_reservations where exchange_id = ${row.id} and status = 'active'`)
  await releaseReservations(
    tx,
    held.rows.map((r) => r.id),
    "released",
  )
  await tx.execute(sql`
    update order_items set exchanged_quantity = greatest(exchanged_quantity - ${row.quantity}, 0)
    where id = ${row.order_item_id}`)
  if (row.difference_payment_id) {
    const paid = await tx.execute<{ amount: number }>(sql`
      select amount_paise - refunded_paise as amount from payments
      where id = ${row.difference_payment_id} and status in ('captured', 'partially_refunded')`)
    const amount = paid.rows[0]?.amount ?? 0
    if (amount > 0) {
      await requestRefund(tx, {
        paymentId: row.difference_payment_id,
        orderId: row.order_id,
        amountPaise: amount,
        reason: "exchange_qc_failed",
        idempotencyKey: `exchange:${row.id}:qc-refund`,
        initiatedBy: actor.kind === "user" ? actor.userId : null,
      })
    }
  }
  await setStatus(tx, row, "qc_failed", { note, field: "qc" })
  await notifyCustomer(
    tx,
    row,
    "We couldn't accept the returned item",
    `${note} We're sending your item back to you at no cost${
      row.difference_payment_id ? ", and refunding the difference you paid" : ""
    }.`,
  )
  return createShipmentRecord(tx, {
    orderId: row.order_id,
    orderNumber: row.order_number,
    direction: "replacement",
    exchangeId: row.id,
    codAmountPaise: 0,
    weightGrams: await parcelWeight(tx, row),
    lengthCm: 30,
    breadthCm: 25,
    heightCm: 5,
    customs: null,
    items: [],
    createdBy: actor.kind === "user" ? actor.userId : null,
  })
}

/** Parcel events for exchange parcels move the exchange along. */
async function onParcel(tx: Transaction, change: ShipmentStatusChange) {
  if (change.direction === "forward" || !change.exchangeId) return
  const row = await lockExchange(tx, { id: change.exchangeId })
  if (change.direction === "reverse") {
    if (change.to === "ready_to_ship" && row.status === "approved") {
      await setStatus(tx, row, "pickup_scheduled")
      await notifyCustomer(
        tx,
        row,
        "Pickup booked",
        "A courier will collect the item in the next few days. Pack it with its tags; they'll bring the label.",
      )
    } else if (
      ["picked_up", "in_transit", "out_for_delivery"].includes(change.to) &&
      ["approved", "pickup_scheduled"].includes(row.status)
    ) {
      await setStatus(tx, row, "picked_up")
    } else if (
      change.to === "delivered" &&
      ["approved", "pickup_scheduled", "picked_up"].includes(row.status)
    ) {
      await setStatus(tx, row, "received")
    }
    return
  }
  // Replacement parcel (or the item sent back after a failed QC).
  if (row.status === "qc_failed") return
  if (change.to === "ready_to_ship" && row.status === "qc_passed") {
    const held = await tx.execute<{ id: string }>(sql`
      select id from inventory_reservations where exchange_id = ${row.id} and status = 'active'`)
    await commitReservations(
      tx,
      held.rows.map((r) => r.id),
      { type: "exchange", id: row.id },
      "exchange_out",
    )
    await setStatus(tx, row, "replacement_shipped")
    const parcel = await tx.execute<{
      awb: string | null
      courier_name: string | null
    }>(
      sql`select awb, courier_name from shipments where id = ${change.shipmentId}`,
    )
    await notifyCustomer(
      tx,
      row,
      "Your replacement is on its way",
      `It's with ${parcel.rows[0]?.courier_name ?? "our courier"}, tracking number ${parcel.rows[0]?.awb ?? "to follow"}.`,
    )
  } else if (
    change.to === "delivered" &&
    row.status === "replacement_shipped"
  ) {
    await setStatus(tx, row, "completed")
    await notifyCustomer(
      tx,
      row,
      "Exchange complete",
      "Your replacement has been delivered. We hope it fits just right.",
    )
  }
}

onShipmentStatusChanged(onParcel)

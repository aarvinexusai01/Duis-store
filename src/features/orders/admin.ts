import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import type { ShipmentCustoms, ShippingAddressSnapshot } from "@/db/schema"
import { addressInputSchema } from "@/features/customers"
import { requestRefund } from "@/features/payments"
import {
  advanceShipment,
  cancelShipmentAtCourier,
  createShipmentRecord,
  customsFor,
  getShippingProvider,
  readShipmentLabel,
  scheduleShipmentRetry,
  simulateTrackingEvent,
  type ShipmentStatus,
} from "@/features/shipping"
import { creditWallet } from "@/features/wallet"
import { formatPaise } from "@/lib/money"
import type { Actor } from "@/server/auth/actor"
import { rolesAllow } from "@/server/auth/permissions"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { queueEmail } from "@/server/notifications/email"
import { defineOperation } from "@/server/operation"

import "./fulfilment"
import {
  cancelConfirmedOrder,
  lockOrder,
  recordChange,
  type OrderRow,
} from "./lifecycle"

/**
 * Staff order tools (doc/06 Phase 4 §8–9). Money is shown only to roles with
 * `order: read_financials`; packing staff see items, addresses and parcels.
 */

export const ADMIN_ORDERS_PAGE_SIZE = 50
const orderNumber = z.string().regex(/^DUIS-\d{6,}$/)

export function canSeeMoney(actor: Actor): boolean {
  return (
    actor.kind === "system" ||
    (actor.kind === "user" &&
      rolesAllow(actor.roles, { order: ["read_financials"] }))
  )
}

const userIdOf = (actor: Actor) => (actor.kind === "user" ? actor.userId : null)

async function findOrderId(tx: Transaction, number: string): Promise<string> {
  const found = await tx.execute<{ id: string }>(
    sql`select id from orders where order_number = ${number}`,
  )
  if (!found.rows[0]) throw new DomainError("NOT_FOUND", "Order not found.")
  return found.rows[0].id
}

// --- List -------------------------------------------------------------------------------

export const ORDER_VIEWS = [
  "to_ship",
  "in_transit",
  "cod_pending",
  "rto",
] as const
export const ORDER_STATUSES = z.enum([
  "pending_payment",
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "expired",
  "rto_initiated",
  "rto_delivered",
])

export type AdminOrderRow = {
  orderNumber: string
  placedAt: Date
  customerName: string
  status: string
  paymentStatus: string
  paymentMode: "prepaid" | "partial_cod"
  isExport: boolean
  itemCount: number
  totalPaise: number | null
  shipmentStatus: ShipmentStatus | null
  awb: string | null
}

export const adminListOrders = defineOperation({
  name: "orders.adminList",
  access: { order: ["read"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    status: ORDER_STATUSES.optional(),
    paymentMode: z.enum(["prepaid", "partial_cod"]).optional(),
    view: z.enum(ORDER_VIEWS).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler({ actor }, input) {
    const like = input.q ? `%${input.q.replace(/[%_\\]/g, "\\$&")}%` : null
    const view = {
      to_ship: sql`and o.status in ('confirmed', 'processing')
        and not exists (select 1 from shipments s where s.order_id = o.id and s.status not in ('cancelled', 'pending'))`,
      in_transit: sql`and o.status in ('shipped', 'out_for_delivery')`,
      cod_pending: sql`and o.payment_mode = 'partial_cod' and o.status = 'delivered' and o.cod_collected_at is null`,
      rto: sql`and o.status in ('rto_initiated', 'rto_delivered')`,
    }
    const rows = await getDb().execute<{
      order_number: string
      placed_at: Date
      customer_name: string
      status: string
      payment_status: string
      payment_mode: "prepaid" | "partial_cod"
      is_export: boolean
      item_count: number
      total_paise: number
      shipment_status: ShipmentStatus | null
      awb: string | null
      total: number
    }>(sql`
      select o.order_number, o.placed_at, o.customer_name, o.status, o.payment_status, o.payment_mode,
             o.is_export, o.total_paise,
             (select coalesce(sum(quantity), 0)::int from order_items where order_id = o.id) as item_count,
             s.status as shipment_status, s.awb,
             count(*) over ()::int as total
      from orders o
      left join lateral (
        select status, awb from shipments where order_id = o.id order by created_at desc limit 1
      ) s on true
      where true
        ${input.status ? sql`and o.status = ${input.status}` : sql`and o.status <> 'expired'`}
        ${input.paymentMode ? sql`and o.payment_mode = ${input.paymentMode}` : sql``}
        ${input.view ? view[input.view] : sql``}
        ${input.from ? sql`and o.placed_at >= (${input.from}::date)::timestamp at time zone 'Asia/Kolkata'` : sql``}
        ${input.to ? sql`and o.placed_at < (${input.to}::date + 1)::timestamp at time zone 'Asia/Kolkata'` : sql``}
        ${
          like
            ? sql`and (o.order_number ilike ${like} or o.customer_name ilike ${like}
                     or o.customer_email ilike ${like} or o.customer_phone ilike ${like}
                     or exists (select 1 from shipments x where x.order_id = o.id and x.awb ilike ${like}))`
            : sql``
        }
      order by o.placed_at desc
      limit ${ADMIN_ORDERS_PAGE_SIZE} offset ${(input.page - 1) * ADMIN_ORDERS_PAGE_SIZE}`)
    const money = canSeeMoney(actor)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r): AdminOrderRow => ({
        orderNumber: r.order_number,
        placedAt: new Date(r.placed_at),
        customerName: r.customer_name,
        status: r.status,
        paymentStatus: r.payment_status,
        paymentMode: r.payment_mode,
        isExport: r.is_export,
        itemCount: r.item_count,
        totalPaise: money ? r.total_paise : null,
        shipmentStatus: r.shipment_status,
        awb: r.awb,
      })),
    }
  },
})

// --- Detail -----------------------------------------------------------------------------

type Refundable = { toSourcePaise: number; toWalletPaise: number }

/**
 * What can still be refunded: everything collected (online, wallet and COD
 * cash) minus what was already refunded or returned to the wallet.
 */
async function refundableFor(
  db: Transaction | ReturnType<typeof getDb>,
  orderId: string,
): Promise<Refundable & { perPayment: { id: string; available: number }[] }> {
  // One after another: inside a transaction they share one connection.
  const payments = await db.execute<{
    id: string
    amount_paise: number
    used: number
  }>(sql`
      select p.id, p.amount_paise,
        p.refunded_paise + coalesce((select sum(r.amount_paise) from refunds r
                                     where r.payment_id = p.id and r.status = 'pending'), 0)::int as used
      from payments p
      where p.order_id = ${orderId} and p.status in ('captured', 'partially_refunded', 'refunded')`)
  const ledger = await db.execute<{ paid: number; returned: number }>(sql`
      select coalesce(-sum(amount_paise) filter (where reason = 'order_payment'), 0)::int as paid,
             coalesce(sum(amount_paise) filter (where reason in ('order_reversal', 'cancellation_refund', 'order_refund', 'rto_advance_credit')), 0)::int as returned
      from wallet_ledger where reference_type = 'order' and reference_id = ${orderId}`)
  const cash = await db.execute<{ amount: number }>(
    sql`select coalesce(sum(amount_paise), 0)::int as amount from cod_remittances where order_id = ${orderId}`,
  )
  const perPayment = payments.rows
    .map((p) => ({ id: p.id, available: Math.max(0, p.amount_paise - p.used) }))
    .sort((a, b) => b.available - a.available)
  const paidOnline = payments.rows.reduce((s, p) => s + p.amount_paise, 0)
  const refundedOnline = payments.rows.reduce((s, p) => s + p.used, 0)
  const remaining = Math.max(
    0,
    paidOnline +
      ledger.rows[0]!.paid +
      cash.rows[0]!.amount -
      refundedOnline -
      ledger.rows[0]!.returned,
  )
  const source = perPayment.reduce((s, p) => s + p.available, 0)
  return {
    perPayment,
    toSourcePaise: Math.min(remaining, source),
    toWalletPaise: remaining,
  }
}

export type AdminOrderDetail = {
  id: string
  orderNumber: string
  status: string
  paymentStatus: string
  fulfillmentStatus: string
  paymentMode: "prepaid" | "partial_cod"
  isExport: boolean
  destinationCountry: string
  placedAt: Date
  cancelReason: string | null
  shippingAddress: ShippingAddressSnapshot
  customer: {
    userId: string
    name: string
    email: string | null
    phone: string | null
    codBlocked: boolean
    orderCount: number
  }
  items: {
    id: string
    title: string
    variantLabel: string
    sku: string
    hsnCode: string
    imageKey: string | null
    quantity: number
    weightGrams: number
    money: {
      unitPricePaise: number
      discountPaise: number
      lineTotalPaise: number
      taxRateBp: number
      taxablePaise: number
      cgstPaise: number
      sgstPaise: number
      igstPaise: number
    } | null
  }[]
  money: {
    subtotalPaise: number
    discountPaise: number
    shippingFeePaise: number
    codFeePaise: number
    taxTotalPaise: number
    totalPaise: number
    walletAppliedPaise: number
    onlineAmountPaise: number
    codDuePaise: number
    couponCode: string | null
    discounts: { label: string; amountPaise: number }[]
    payments: {
      id: string
      provider: string
      providerPaymentId: string | null
      purpose: string
      amountPaise: number
      refundedPaise: number
      status: string
      method: string | null
      capturedAt: Date | null
    }[]
    refunds: {
      amountPaise: number
      status: string
      reason: string
      at: Date
      by: string | null
    }[]
    wallet: { amountPaise: number; reason: string; at: Date }[]
    remittance: { amountPaise: number; utr: string; remittedAt: Date } | null
    refundable: Refundable
  } | null
  shipments: {
    id: string
    status: ShipmentStatus
    provider: string
    awb: string | null
    courierName: string | null
    codAmountPaise: number | null
    weightGrams: number
    dimensions: string
    hasLabel: boolean
    lastError: string | null
    attempts: number
    pickupScheduledAt: Date | null
    createdAt: Date
    customs: ShipmentCustoms | null
    events: {
      providerStatus: string
      status: ShipmentStatus | null
      location: string | null
      occurredAt: Date
    }[]
  }[]
  notes: { body: string; author: string | null; at: Date }[]
  history: {
    field: string
    from: string | null
    to: string
    reason: string | null
    by: string | null
    at: Date
  }[]
  can: {
    startProcessing: boolean
    ship: boolean
    cancel: boolean
    editAddress: boolean
    simulate: boolean
  }
}

export const adminGetOrder = defineOperation({
  name: "orders.adminGet",
  access: { order: ["read"] },
  input: z.object({ orderNumber }),
  async handler({ actor }, input): Promise<AdminOrderDetail> {
    const db = getDb()
    const found = await db.execute<{
      id: string
      order_number: string
      status: string
      payment_status: string
      fulfillment_status: string
      payment_mode: "prepaid" | "partial_cod"
      is_export: boolean
      destination_country: string
      placed_at: Date
      cancel_reason: string | null
      shipping_address: ShippingAddressSnapshot
      user_id: string
      customer_name: string
      customer_email: string | null
      customer_phone: string | null
      subtotal_paise: number
      discount_paise: number
      shipping_fee_paise: number
      cod_fee_paise: number
      tax_total_paise: number
      total_paise: number
      wallet_applied_paise: number
      online_amount_paise: number
      cod_due_paise: number
      coupon_code: string | null
      cod_blocked: boolean | null
      order_count: number
    }>(sql`
      select o.*, cp.cod_blocked,
        (select count(*)::int from orders x where x.user_id = o.user_id and x.status not in ('pending_payment', 'expired')) as order_count
      from orders o left join customer_profiles cp on cp.user_id = o.user_id
      where o.order_number = ${input.orderNumber}`)
    const o = found.rows[0]
    if (!o) throw new DomainError("NOT_FOUND", "Order not found.")
    const money = canSeeMoney(actor)

    const [items, shipments, events, notes, history] = await Promise.all([
      db.execute<{
        id: string
        title: string
        variant_label: string
        sku: string
        hsn_code: string
        image_key: string | null
        quantity: number
        weight_grams: number
        unit_price_paise: number
        discount_paise: number
        line_total_paise: number
        tax_rate_bp: number
        taxable_paise: number
        cgst_paise: number
        sgst_paise: number
        igst_paise: number
      }>(sql`
        select oi.*, coalesce(v.weight_grams_override, p.weight_grams, 300) as weight_grams
        from order_items oi
        left join product_variants v on v.id = oi.variant_id
        left join products p on p.id = oi.product_id
        where oi.order_id = ${o.id} order by oi.position`),
      db.execute<{
        id: string
        status: ShipmentStatus
        provider: string
        awb: string | null
        courier_name: string | null
        cod_amount_paise: number
        weight_grams: number
        length_cm: number
        breadth_cm: number
        height_cm: number
        label_file_key: string | null
        last_error: string | null
        attempts: number
        pickup_scheduled_at: Date | null
        created_at: Date
        customs: ShipmentCustoms | null
      }>(
        sql`select * from shipments where order_id = ${o.id} order by created_at desc`,
      ),
      db.execute<{
        shipment_id: string
        provider_status: string
        status: ShipmentStatus | null
        location: string | null
        occurred_at: Date
      }>(sql`
        select e.shipment_id, e.provider_status, e.status, e.location, e.occurred_at
        from shipment_tracking_events e join shipments s on s.id = e.shipment_id
        where s.order_id = ${o.id} order by e.occurred_at desc`),
      db.execute<{ body: string; author: string | null; created_at: Date }>(sql`
        select n.body, u.name as author, n.created_at from order_notes n
        left join users u on u.id = n.author_user_id
        where n.order_id = ${o.id} order by n.created_at desc`),
      db.execute<{
        field: string
        from_value: string | null
        to_value: string
        reason: string | null
        actor_type: string
        by: string | null
        created_at: Date
      }>(sql`
        select h.field, h.from_value, h.to_value, h.reason, h.actor_type, u.name as by, h.created_at
        from order_status_history h left join users u on u.id = h.actor_user_id
        where h.order_id = ${o.id} order by h.created_at desc`),
    ])

    let moneyBlock: AdminOrderDetail["money"] = null
    if (money) {
      const [discounts, payments, refundRows, wallet, remittance, refundable] =
        await Promise.all([
          db.execute<{ label: string; amount_paise: number }>(
            sql`select label, amount_paise from order_discounts where order_id = ${o.id}`,
          ),
          db.execute<{
            id: string
            provider: string
            provider_payment_id: string | null
            purpose: string
            amount_paise: number
            refunded_paise: number
            status: string
            method: string | null
            captured_at: Date | null
          }>(sql`
            select id, provider, provider_payment_id, purpose, amount_paise, refunded_paise, status, method, captured_at
            from payments where order_id = ${o.id} order by created_at`),
          db.execute<{
            amount_paise: number
            status: string
            reason: string
            created_at: Date
            by: string | null
          }>(sql`
            select r.amount_paise, r.status, r.reason, r.created_at, u.name as by
            from refunds r left join users u on u.id = r.initiated_by
            where r.order_id = ${o.id} order by r.created_at`),
          db.execute<{
            amount_paise: number
            reason: string
            created_at: Date
          }>(sql`
            select amount_paise, reason, created_at from wallet_ledger
            where reference_type = 'order' and reference_id = ${o.id} order by created_at`),
          db.execute<{ amount_paise: number; utr: string; remitted_at: Date }>(
            sql`select amount_paise, utr, remitted_at from cod_remittances where order_id = ${o.id}`,
          ),
          refundableFor(db, o.id),
        ])
      moneyBlock = {
        subtotalPaise: o.subtotal_paise,
        discountPaise: o.discount_paise,
        shippingFeePaise: o.shipping_fee_paise,
        codFeePaise: o.cod_fee_paise,
        taxTotalPaise: o.tax_total_paise,
        totalPaise: o.total_paise,
        walletAppliedPaise: o.wallet_applied_paise,
        onlineAmountPaise: o.online_amount_paise,
        codDuePaise: o.cod_due_paise,
        couponCode: o.coupon_code,
        discounts: discounts.rows.map((d) => ({
          label: d.label,
          amountPaise: d.amount_paise,
        })),
        payments: payments.rows.map((p) => ({
          id: p.id,
          provider: p.provider,
          providerPaymentId: p.provider_payment_id,
          purpose: p.purpose,
          amountPaise: p.amount_paise,
          refundedPaise: p.refunded_paise,
          status: p.status,
          method: p.method,
          capturedAt: p.captured_at ? new Date(p.captured_at) : null,
        })),
        refunds: refundRows.rows.map((r) => ({
          amountPaise: r.amount_paise,
          status: r.status,
          reason: r.reason,
          at: new Date(r.created_at),
          by: r.by,
        })),
        wallet: wallet.rows.map((w) => ({
          amountPaise: w.amount_paise,
          reason: w.reason,
          at: new Date(w.created_at),
        })),
        remittance: remittance.rows[0]
          ? {
              amountPaise: remittance.rows[0].amount_paise,
              utr: remittance.rows[0].utr,
              remittedAt: new Date(remittance.rows[0].remitted_at),
            }
          : null,
        refundable: {
          toSourcePaise: refundable.toSourcePaise,
          toWalletPaise: refundable.toWalletPaise,
        },
      }
    }

    const live = shipments.rows.find((s) => s.status !== "cancelled")
    const open = ["confirmed", "processing"].includes(o.status)
    const fake =
      getShippingProvider().name === "fake" &&
      getServerEnv().APP_ENV !== "production"
    return {
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      paymentStatus: o.payment_status,
      fulfillmentStatus: o.fulfillment_status,
      paymentMode: o.payment_mode,
      isExport: o.is_export,
      destinationCountry: o.destination_country,
      placedAt: new Date(o.placed_at),
      cancelReason: o.cancel_reason,
      shippingAddress: o.shipping_address,
      customer: {
        userId: o.user_id,
        name: o.customer_name,
        email: o.customer_email?.endsWith(".invalid") ? null : o.customer_email,
        phone: o.customer_phone,
        codBlocked: Boolean(o.cod_blocked),
        orderCount: o.order_count,
      },
      items: items.rows.map((i) => ({
        id: i.id,
        title: i.title,
        variantLabel: i.variant_label,
        sku: i.sku,
        hsnCode: i.hsn_code,
        imageKey: i.image_key,
        quantity: i.quantity,
        weightGrams: i.weight_grams,
        money: money
          ? {
              unitPricePaise: i.unit_price_paise,
              discountPaise: i.discount_paise,
              lineTotalPaise: i.line_total_paise,
              taxRateBp: i.tax_rate_bp,
              taxablePaise: i.taxable_paise,
              cgstPaise: i.cgst_paise,
              sgstPaise: i.sgst_paise,
              igstPaise: i.igst_paise,
            }
          : null,
      })),
      money: moneyBlock,
      shipments: shipments.rows.map((s) => ({
        id: s.id,
        status: s.status,
        provider: s.provider,
        awb: s.awb,
        courierName: s.courier_name,
        codAmountPaise: money ? s.cod_amount_paise : null,
        weightGrams: s.weight_grams,
        dimensions: `${s.length_cm} × ${s.breadth_cm} × ${s.height_cm} cm`,
        hasLabel: Boolean(s.label_file_key),
        lastError: s.last_error,
        attempts: s.attempts,
        pickupScheduledAt: s.pickup_scheduled_at
          ? new Date(s.pickup_scheduled_at)
          : null,
        createdAt: new Date(s.created_at),
        customs: s.customs,
        events: events.rows
          .filter((e) => e.shipment_id === s.id)
          .map((e) => ({
            providerStatus: e.provider_status,
            status: e.status,
            location: e.location,
            occurredAt: new Date(e.occurred_at),
          })),
      })),
      notes: notes.rows.map((n) => ({
        body: n.body,
        author: n.author,
        at: new Date(n.created_at),
      })),
      history: history.rows.map((h) => ({
        field: h.field,
        from: h.from_value,
        to: h.to_value,
        reason: h.reason,
        by: h.by ?? (h.actor_type === "system" ? "System" : null),
        at: new Date(h.created_at),
      })),
      can: {
        startProcessing: o.status === "confirmed" && !live,
        ship: open && o.fulfillment_status === "unfulfilled" && !live,
        cancel:
          open &&
          o.fulfillment_status === "unfulfilled" &&
          (!live || ["pending", "ready_to_ship"].includes(live.status)),
        editAddress: open && !live && o.destination_country === "IN",
        simulate: fake,
      },
    }
  },
})

// --- Status, notes and address ---------------------------------------------------------

export const startProcessing = defineOperation({
  name: "orders.startProcessing",
  access: { order: ["fulfil"] },
  input: z.object({ orderNumber }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const order = await lockOrder(
        tx,
        await findOrderId(tx, input.orderNumber),
      )
      if (order.status !== "confirmed") {
        throw new DomainError(
          "INVALID_STATE",
          "Only confirmed orders can start packing.",
        )
      }
      await tx.execute(
        sql`update orders set status = 'processing', updated_at = now() where id = ${order.id}`,
      )
      await recordChange(tx, order.id, {
        field: "status",
        from: order.status,
        to: "processing",
        actor,
      })
      await writeAudit(tx, actor, {
        action: "order.start_processing",
        entityType: "order",
        entityId: order.id,
      })
      return {}
    })
  },
})

export const addOrderNote = defineOperation({
  name: "orders.addNote",
  access: { order: ["read"] },
  input: z.object({
    orderNumber,
    body: z.string().trim().min(1, "Write a note.").max(2000),
  }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const id = await findOrderId(tx, input.orderNumber)
      await tx.execute(sql`
        insert into order_notes (order_id, author_user_id, body) values (${id}, ${userIdOf(actor)}, ${input.body})`)
      await writeAudit(tx, actor, {
        action: "order.add_note",
        entityType: "order",
        entityId: id,
      })
      return {}
    })
  },
})

/**
 * Corrects the delivery address before a parcel is booked. The country and
 * state stay the same: a different state changes the GST split, which needs
 * a new order (doc/06 Phase 4, 4b assumptions).
 */
export const updateShippingAddress = defineOperation({
  name: "orders.updateShippingAddress",
  access: { order: ["update"] },
  input: z.object({ orderNumber, address: addressInputSchema }),
  async handler({ actor }, input) {
    const address = input.address
    if (address.countryCode !== "IN") {
      throw new DomainError(
        "INVALID_STATE",
        "International addresses can't be changed here.",
      )
    }
    const service = await getShippingProvider().checkServiceability(
      address.postalCode,
    )
    return withTransaction(async (tx) => {
      const order = await lockOrder(
        tx,
        await findOrderId(tx, input.orderNumber),
      )
      const current = await tx.execute<{
        shipping_address: ShippingAddressSnapshot
        live: number
      }>(sql`
        select shipping_address,
          (select count(*)::int from shipments where order_id = ${order.id} and status <> 'cancelled') as live
        from orders where id = ${order.id}`)
      const before = current.rows[0]!
      if (
        !["confirmed", "processing"].includes(order.status) ||
        before.live > 0
      ) {
        throw new DomainError(
          "INVALID_STATE",
          "The address can only change before a parcel is booked.",
        )
      }
      if (
        before.shipping_address.countryCode !== "IN" ||
        before.shipping_address.stateCode !== address.stateCode
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "The state can't change (it changes the GST on the invoice). Cancel and place a new order instead.",
          { issues: { stateCode: ["Keep the same state."] } },
        )
      }
      if (
        !service.serviceable ||
        (order.payment_mode === "partial_cod" && !service.codAvailable)
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "We can't deliver this order to that PIN code.",
          { issues: { postalCode: ["Not serviceable for this order."] } },
        )
      }
      const next: ShippingAddressSnapshot = {
        fullName: address.fullName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2 ?? null,
        landmark: address.landmark ?? null,
        city: address.city,
        region: null,
        stateCode: address.stateCode ?? null,
        postalCode: address.postalCode,
        countryCode: "IN",
      }
      await tx.execute(sql`
        update orders set shipping_address = ${JSON.stringify(next)}::jsonb,
          customer_phone = coalesce(customer_phone, ${next.phone}), updated_at = now()
        where id = ${order.id}`)
      await writeAudit(tx, actor, {
        action: "order.update_address",
        entityType: "order",
        entityId: order.id,
        changes: { before: before.shipping_address, after: next },
      })
      return {}
    })
  },
})

// --- Parcels ----------------------------------------------------------------------------

const DEFAULT_BOX = { lengthCm: 30, breadthCm: 25, heightCm: 5 }
const PACKAGING_GRAMS = 150
// Bulk bookings beyond this go to the job queue instead of waiting inline.
const INLINE_LIMIT = 5

export const createShipments = defineOperation({
  name: "orders.createShipments",
  access: { order: ["fulfil"] },
  input: z.object({
    orderNumbers: z.array(orderNumber).min(1).max(50),
    weightGrams: z.number().int().min(10).max(50_000).optional(),
    lengthCm: z.number().int().min(1).max(200).optional(),
    breadthCm: z.number().int().min(1).max(200).optional(),
    heightCm: z.number().int().min(1).max(200).optional(),
  }),
  async handler({ actor }, input) {
    const results: {
      orderNumber: string
      ok: boolean
      status?: string
      error?: string
    }[] = []
    const inline = input.orderNumbers.length <= INLINE_LIMIT
    for (const number of [...new Set(input.orderNumbers)]) {
      try {
        const shipmentId = await withTransaction(async (tx) => {
          const order = await lockOrder(tx, await findOrderId(tx, number))
          const state = await tx.execute<{
            fulfillment_status: string
            is_export: boolean
          }>(
            sql`select fulfillment_status, is_export from orders where id = ${order.id}`,
          )
          if (
            !["confirmed", "processing"].includes(order.status) ||
            state.rows[0]!.fulfillment_status !== "unfulfilled"
          ) {
            throw new DomainError(
              "INVALID_STATE",
              "Only confirmed orders that haven't shipped can be booked.",
            )
          }
          const items = await tx.execute<{
            id: string
            title: string
            hsn_code: string
            quantity: number
            line_total_paise: number
            weight_grams: number
            country_of_origin: string | null
          }>(sql`
            select oi.id, oi.title, oi.hsn_code, oi.quantity, oi.line_total_paise,
                   coalesce(v.weight_grams_override, p.weight_grams, 300) as weight_grams, p.country_of_origin
            from order_items oi
            left join product_variants v on v.id = oi.variant_id
            left join products p on p.id = oi.product_id
            where oi.order_id = ${order.id} order by oi.position`)
          const weight =
            input.weightGrams ??
            items.rows.reduce((s, i) => s + i.weight_grams * i.quantity, 0) +
              PACKAGING_GRAMS
          const id = await createShipmentRecord(tx, {
            orderId: order.id,
            orderNumber: order.order_number,
            codAmountPaise:
              order.payment_mode === "partial_cod" ? order.cod_due_paise : 0,
            weightGrams: weight,
            lengthCm: input.lengthCm ?? DEFAULT_BOX.lengthCm,
            breadthCm: input.breadthCm ?? DEFAULT_BOX.breadthCm,
            heightCm: input.heightCm ?? DEFAULT_BOX.heightCm,
            customs: state.rows[0]!.is_export
              ? customsFor(
                  items.rows.map((i) => ({
                    title: i.title,
                    hsnCode: i.hsn_code,
                    quantity: i.quantity,
                    lineTotalPaise: i.line_total_paise,
                    countryOfOrigin: i.country_of_origin,
                  })),
                )
              : null,
            items: items.rows.map((i) => ({
              orderItemId: i.id,
              quantity: i.quantity,
            })),
            createdBy: userIdOf(actor),
          })
          if (order.status === "confirmed") {
            await tx.execute(
              sql`update orders set status = 'processing', updated_at = now() where id = ${order.id}`,
            )
            await recordChange(tx, order.id, {
              field: "status",
              from: "confirmed",
              to: "processing",
              actor,
              reason: "parcel_booked",
            })
          }
          await writeAudit(tx, actor, {
            action: "shipment.create",
            entityType: "order",
            entityId: order.id,
            changes: { shipmentId: id, weightGrams: weight },
          })
          return id
        })
        if (inline) {
          const result = await advanceShipment(shipmentId, actor)
          if (result.status === "failed") {
            await scheduleShipmentRetry(shipmentId)
            results.push({
              orderNumber: number,
              ok: false,
              error: result.error,
            })
          } else {
            results.push({
              orderNumber: number,
              ok: true,
              status: result.status,
            })
          }
        } else {
          await scheduleShipmentRetry(shipmentId)
          results.push({ orderNumber: number, ok: true, status: "queued" })
        }
      } catch (error) {
        if (!(error instanceof DomainError)) throw error
        results.push({ orderNumber: number, ok: false, error: error.message })
      }
    }
    return { results }
  },
})

const shipmentInput = z.object({ shipmentId: z.uuid() })

async function auditShipment(actor: Actor, action: string, shipmentId: string) {
  await withTransaction((tx) =>
    writeAudit(tx, actor, {
      action,
      entityType: "shipment",
      entityId: shipmentId,
    }),
  )
}

export const retryShipment = defineOperation({
  name: "orders.retryShipment",
  access: { order: ["fulfil"] },
  input: shipmentInput,
  async handler({ actor }, { shipmentId }) {
    const result = await advanceShipment(shipmentId, actor)
    await auditShipment(actor, "shipment.retry", shipmentId)
    if (result.status === "failed") {
      await scheduleShipmentRetry(shipmentId)
      throw new DomainError(
        "CONFLICT",
        `The courier step failed again: ${result.error}. It will retry in the background.`,
      )
    }
    return { status: result.status }
  },
})

export const cancelShipment = defineOperation({
  name: "orders.cancelShipment",
  access: { order: ["fulfil"] },
  input: shipmentInput,
  async handler({ actor }, { shipmentId }) {
    await cancelShipmentAtCourier(shipmentId, actor)
    await auditShipment(actor, "shipment.cancel", shipmentId)
    return {}
  },
})

export const simulateTracking = defineOperation({
  name: "orders.simulateTracking",
  access: { order: ["fulfil"] },
  input: shipmentInput.extend({
    outcome: z.enum(["next", "undelivered", "rto"]).default("next"),
  }),
  async handler({ actor }, { shipmentId, outcome }) {
    const status = await simulateTrackingEvent(shipmentId, outcome, actor)
    return { status }
  },
})

export const getShipmentLabel = defineOperation({
  name: "orders.getShipmentLabel",
  access: { order: ["fulfil"] },
  input: shipmentInput,
  async handler(_ctx, { shipmentId }) {
    const label = await readShipmentLabel(shipmentId)
    if (!label) throw new DomainError("NOT_FOUND", "Label not found.")
    return label
  },
})

// --- Cancel and refund -----------------------------------------------------------------

/**
 * Staff cancellation (owner decision 2026-10-16): allowed after an AWB and
 * before pickup. The courier cancellation must succeed first; then the order
 * is cancelled, restocked and refunded like a customer cancellation.
 */
export const staffCancelOrder = defineOperation({
  name: "orders.staffCancel",
  access: { order: ["cancel"] },
  input: z.object({
    orderNumber,
    reason: z.string().trim().min(3, "Give a reason.").max(300),
  }),
  async handler({ actor }, input) {
    const parcels = await getDb().execute<{ id: string }>(sql`
      select s.id from shipments s join orders o on o.id = s.order_id
      where o.order_number = ${input.orderNumber} and s.status <> 'cancelled'`)
    for (const parcel of parcels.rows) {
      await cancelShipmentAtCourier(parcel.id, actor)
    }
    return withTransaction(async (tx) => {
      const order = await lockOrder(
        tx,
        await findOrderId(tx, input.orderNumber),
      )
      const result = await cancelConfirmedOrder(tx, order, actor, {
        by: "staff",
        reason: input.reason,
      })
      await writeAudit(tx, actor, {
        action: "order.cancel",
        entityType: "order",
        entityId: order.id,
        changes: { reason: input.reason, ...result },
      })
      return result
    })
  },
})

/**
 * A staff refund (owner decision 2026-10-16): partial or full, up to what was
 * collected, to the original payment or to the wallet, with a reason.
 */
export const refundOrder = defineOperation({
  name: "orders.refund",
  access: { order: ["refund"] },
  input: z.object({
    orderNumber,
    amountPaise: z.number().int().min(100, "At least ₹1."),
    destination: z.enum(["source", "wallet"]),
    reason: z.string().trim().min(3, "Give a reason.").max(300),
    idempotencyKey: z.uuid(),
  }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const order = await lockOrder(
        tx,
        await findOrderId(tx, input.orderNumber),
      )
      if (["pending_payment", "expired"].includes(order.status)) {
        throw new DomainError(
          "INVALID_STATE",
          "Nothing was paid on this order.",
        )
      }
      const refundable = await refundableFor(tx, order.id)
      const max =
        input.destination === "source"
          ? refundable.toSourcePaise
          : refundable.toWalletPaise
      if (input.amountPaise > max) {
        throw new DomainError(
          "VALIDATION_FAILED",
          `At most ${formatPaise(max)} can be refunded ${input.destination === "source" ? "to the original payment" : "to the wallet"}.`,
          { issues: { amountPaise: [`Up to ${formatPaise(max)}.`] } },
        )
      }
      if (input.destination === "source") {
        let left = input.amountPaise
        for (const payment of refundable.perPayment) {
          if (left === 0) break
          const part = Math.min(left, payment.available)
          if (part <= 0) continue
          await requestRefund(tx, {
            paymentId: payment.id,
            orderId: order.id,
            amountPaise: part,
            reason: `staff: ${input.reason}`,
            idempotencyKey: `staff-refund:${input.idempotencyKey}:${payment.id}`,
            initiatedBy: userIdOf(actor),
          })
          left -= part
        }
      } else {
        const credited = await creditWallet(tx, {
          userId: order.user_id,
          amountPaise: input.amountPaise,
          reason: "order_refund",
          reference: { type: "order", id: order.id },
          idempotencyKey: `staff-refund:${input.idempotencyKey}`,
          createdBy: userIdOf(actor),
          note: input.reason,
        })
        if (credited)
          await walletRefundDone(tx, order, input.amountPaise, actor)
      }
      await writeAudit(tx, actor, {
        action: "order.refund",
        entityType: "order",
        entityId: order.id,
        changes: {
          amountPaise: input.amountPaise,
          destination: input.destination,
          reason: input.reason,
        },
      })
      return {}
    })
  },
})

async function walletRefundDone(
  tx: Transaction,
  order: OrderRow,
  amountPaise: number,
  actor: Actor,
) {
  const left = await refundableFor(tx, order.id)
  const next = left.toWalletPaise === 0 ? "refunded" : "partially_refunded"
  if (next !== order.payment_status) {
    await tx.execute(sql`
      update orders set payment_status = ${next}::order_payment_status, updated_at = now() where id = ${order.id}`)
    await recordChange(tx, order.id, {
      field: "payment_status",
      from: order.payment_status,
      to: next,
      actor,
    })
  }
  if (order.customer_email && !order.customer_email.endsWith(".invalid")) {
    await queueEmail(
      {
        template: "refund-issued",
        to: order.customer_email,
        userId: order.user_id,
        reference: { type: "order", id: order.id },
        props: {
          name: order.customer_name,
          orderNumber: order.order_number,
          url: new URL(
            `/account/orders/${order.order_number}`,
            getServerEnv().APP_URL,
          ).toString(),
          amount: formatPaise(amountPaise),
          toWallet: true,
        },
      },
      { tx },
    )
  }
}

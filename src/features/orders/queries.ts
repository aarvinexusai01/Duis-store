import "server-only"
import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import {
  orderItems,
  orders,
  orderStatusHistory,
  products,
  refunds,
  type ShippingAddressSnapshot,
} from "@/db/schema"
import { ensureShipmentInvoice } from "@/features/shipping"
import type { Currency } from "@/lib/fx"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { trackingToken } from "./tracking"

/** The customer's own orders (account pages). Never cached: personal data. */

export type OrderSummary = {
  orderNumber: string
  status: string
  paymentStatus: string
  totalPaise: number
  /** The total as charged, in `currency`. */
  currency: Currency
  totalCharged: number
  itemCount: number
  placedAt: Date
  imageKey: string | null
}

export const listMyOrders = defineOperation({
  name: "orders.listMine",
  access: "authenticated",
  input: z.object({}),
  async handler({ actor }): Promise<OrderSummary[]> {
    if (actor.kind !== "user")
      throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
    // Unpaid attempts that expired are not orders the customer placed.
    const result = await getDb().execute<{
      order_number: string
      status: string
      payment_status: string
      total_paise: number
      currency: Currency
      total_charged: number
      item_count: number
      placed_at: Date
      image_key: string | null
    }>(sql`
      select o.order_number, o.status, o.payment_status, o.total_paise, o.placed_at, o.currency,
             coalesce(o.total_minor, o.total_paise) as total_charged,
             (select sum(quantity)::int from order_items where order_id = o.id) as item_count,
             (select image_key from order_items where order_id = o.id order by position limit 1) as image_key
      from orders o
      where o.user_id = ${actor.userId} and o.status <> 'expired'
      order by o.placed_at desc limit 100`)
    return result.rows.map((r) => ({
      orderNumber: r.order_number,
      status: r.status,
      paymentStatus: r.payment_status,
      totalPaise: r.total_paise,
      currency: r.currency,
      totalCharged: r.total_charged,
      itemCount: r.item_count,
      placedAt: new Date(r.placed_at),
      imageKey: r.image_key,
    }))
  },
})

export type OrderDetail = {
  id: string
  orderNumber: string
  status: string
  paymentStatus: string
  fulfillmentStatus: string
  paymentMode: "prepaid" | "partial_cod"
  placedAt: Date
  confirmedAt: Date | null
  cancelledAt: Date | null
  reservationExpiresAt: Date | null
  shippingAddress: ShippingAddressSnapshot
  subtotalPaise: number
  discountPaise: number
  shippingFeePaise: number
  codFeePaise: number
  taxTotalPaise: number
  totalPaise: number
  walletAppliedPaise: number
  onlineAmountPaise: number
  codDuePaise: number
  /**
   * What the customer was charged, in minor units of `currency` (doc/06
   * Phase 13): the same as the *Paise fields for rupee orders; the dollar
   * amounts for USD orders, whose *Paise fields are the rupee books.
   */
  currency: Currency
  charged: {
    subtotal: number
    discount: number
    shippingFee: number
    total: number
  }
  couponCode: string | null
  isExport: boolean
  canCancel: boolean
  canPay: boolean
  /** The live parcel, once booked. */
  parcel: { courier: string | null; awb: string; status: string } | null
  /** A signed link to the public tracking page. */
  trackingPath: string
  /** The courier's invoice can be downloaded (doc/01 D10). */
  hasInvoice: boolean
  items: {
    productId: string | null
    title: string
    variantLabel: string
    sku: string
    imageKey: string | null
    quantity: number
    unitPricePaise: number
    /** The unit price as charged, in `currency`. */
    unitPriceCharged: number
    discountPaise: number
    lineTotalPaise: number
    /** The line as charged, in `currency` (the dollars on a USD order). */
    lineTotalCharged: number
    productSlug: string | null
  }[]
  history: { field: string; to: string; at: Date }[]
  refunds: { amountPaise: number; status: string; at: Date }[]
}

export const getMyOrder = defineOperation({
  name: "orders.getMine",
  access: "authenticated",
  input: z.object({ orderNumber: z.string().regex(/^DUIS-\d{6,}$/) }),
  async handler({ actor }, { orderNumber }): Promise<OrderDetail> {
    if (actor.kind !== "user")
      throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
    const db = getDb()
    const [o] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.orderNumber, orderNumber),
          eq(orders.userId, actor.userId),
        ),
      )
    if (!o) throw new DomainError("NOT_FOUND", "Order not found.")
    const [items, history, refundRows] = await Promise.all([
      db
        .select({
          productId: orderItems.productId,
          title: orderItems.title,
          variantLabel: orderItems.variantLabel,
          sku: orderItems.sku,
          imageKey: orderItems.imageKey,
          quantity: orderItems.quantity,
          unitPricePaise: orderItems.unitPricePaise,
          unitPriceCharged: sql<number>`coalesce(${orderItems.unitPriceMinor}, ${orderItems.unitPricePaise})`,
          discountPaise: orderItems.discountPaise,
          lineTotalPaise: orderItems.lineTotalPaise,
          lineTotalCharged: sql<number>`coalesce(${orderItems.lineTotalMinor}, ${orderItems.lineTotalPaise})`,
          productSlug: sql<
            string | null
          >`case when ${products.status} = 'active' then ${products.slug}::text end`,
        })
        .from(orderItems)
        .leftJoin(products, eq(products.id, orderItems.productId))
        .where(eq(orderItems.orderId, o.id))
        .orderBy(asc(orderItems.position)),
      db
        .select({
          field: orderStatusHistory.field,
          to: orderStatusHistory.toValue,
          at: orderStatusHistory.createdAt,
        })
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, o.id))
        .orderBy(asc(orderStatusHistory.createdAt)),
      db
        .select({
          amountPaise: refunds.amountPaise,
          status: refunds.status,
          at: refunds.createdAt,
        })
        .from(refunds)
        .where(eq(refunds.orderId, o.id))
        .orderBy(asc(refunds.createdAt)),
    ])
    const parcels = await db.execute<{
      courier_name: string | null
      awb: string | null
      status: string
    }>(sql`
      select courier_name, awb, status from shipments
      where order_id = ${o.id} and status <> 'cancelled' order by created_at desc limit 1`)
    const parcel = parcels.rows[0]
    const invoiceParcel = await invoiceShipmentId(o.id)
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      paymentMode: o.paymentMode,
      placedAt: o.placedAt,
      confirmedAt: o.confirmedAt,
      cancelledAt: o.cancelledAt,
      reservationExpiresAt: o.reservationExpiresAt,
      shippingAddress: o.shippingAddress,
      subtotalPaise: o.subtotalPaise,
      discountPaise: o.discountPaise,
      shippingFeePaise: o.shippingFeePaise,
      codFeePaise: o.codFeePaise,
      taxTotalPaise: o.taxTotalPaise,
      totalPaise: o.totalPaise,
      walletAppliedPaise: o.walletAppliedPaise,
      onlineAmountPaise: o.onlineAmountPaise,
      codDuePaise: o.codDuePaise,
      currency: o.currency as Currency,
      charged:
        o.currency === "USD"
          ? {
              subtotal: o.subtotalMinor!,
              discount: o.discountMinor!,
              shippingFee: o.shippingFeeMinor!,
              total: o.totalMinor!,
            }
          : {
              subtotal: o.subtotalPaise,
              discount: o.discountPaise,
              shippingFee: o.shippingFeePaise,
              total: o.totalPaise,
            },
      couponCode: o.couponCode,
      isExport: o.isExport,
      // Once a parcel is booked, only staff can cancel (with the courier).
      canCancel:
        ["confirmed", "processing"].includes(o.status) &&
        o.fulfillmentStatus === "unfulfilled" &&
        !parcel,
      canPay:
        o.status === "pending_payment" &&
        o.onlineAmountPaise > 0 &&
        o.reservationExpiresAt !== null &&
        o.reservationExpiresAt.getTime() > Date.now(),
      parcel: parcel?.awb
        ? {
            courier: parcel.courier_name,
            awb: parcel.awb,
            status: parcel.status,
          }
        : null,
      trackingPath: `/track/${o.orderNumber}?t=${trackingToken(o.orderNumber)}`,
      hasInvoice: invoiceParcel !== null,
      items,
      history,
      refunds: refundRows,
    }
  },
})

/** The order's own parcel that has (or can get) a courier invoice. */
async function invoiceShipmentId(orderId: string): Promise<string | null> {
  const found = await getDb().execute<{ id: string }>(sql`
    select id from shipments
    where order_id = ${orderId} and direction = 'forward' and exchange_id is null
      and (invoice_file_key is not null or (provider_order_id is not null and status <> 'cancelled'))
    order by (invoice_file_key is not null) desc, created_at desc limit 1`)
  return found.rows[0]?.id ?? null
}

/** The customer's invoice for their own order, fetched if not stored yet. */
export const getMyOrderInvoice = defineOperation({
  name: "orders.getMyInvoice",
  access: "authenticated",
  input: z.object({ orderNumber: z.string().regex(/^DUIS-\d{6,}$/) }),
  async handler({ actor }, { orderNumber }) {
    if (actor.kind !== "user")
      throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
    const [o] = await getDb()
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.orderNumber, orderNumber),
          eq(orders.userId, actor.userId),
        ),
      )
    const shipmentId = o ? await invoiceShipmentId(o.id) : null
    const data = shipmentId
      ? await ensureShipmentInvoice(shipmentId).catch(() => null)
      : null
    if (!data) throw new DomainError("NOT_FOUND", "Invoice not ready yet.")
    return { data }
  },
})

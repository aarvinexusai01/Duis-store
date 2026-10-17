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
      item_count: number
      placed_at: Date
      image_key: string | null
    }>(sql`
      select o.order_number, o.status, o.payment_status, o.total_paise, o.placed_at,
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
  couponCode: string | null
  isExport: boolean
  canCancel: boolean
  canPay: boolean
  /** The live parcel, once booked. */
  parcel: { courier: string | null; awb: string; status: string } | null
  /** A signed link to the public tracking page. */
  trackingPath: string
  items: {
    productId: string | null
    title: string
    variantLabel: string
    sku: string
    imageKey: string | null
    quantity: number
    unitPricePaise: number
    discountPaise: number
    lineTotalPaise: number
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
          discountPaise: orderItems.discountPaise,
          lineTotalPaise: orderItems.lineTotalPaise,
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
      items,
      history,
      refunds: refundRows,
    }
  },
})

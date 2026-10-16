import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { productVariants, products } from "./catalog"
import { citext, primaryId, timestamps, timestamptz } from "./columns"
import { coupons, discounts } from "./discounts"

export const orderStatus = pgEnum("order_status", [
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
export const orderPaymentStatus = pgEnum("order_payment_status", [
  "unpaid",
  "partially_paid",
  "paid",
  "partially_refunded",
  "refunded",
])
export const fulfillmentStatus = pgEnum("fulfillment_status", [
  "unfulfilled",
  "partially_fulfilled",
  "fulfilled",
  "partially_returned",
  "returned",
])
export const paymentMode = pgEnum("payment_mode", ["prepaid", "partial_cod"])
export const orderHistoryField = pgEnum("order_history_field", [
  "status",
  "payment_status",
  "fulfillment_status",
])
export const couponRedemptionStatus = pgEnum("coupon_redemption_status", [
  "active",
  "reversed",
])

/** DUIS-100001, DUIS-100002… (doc/10 P17). Gaps are fine; reuse is not. */
export const orderNumberSeq = pgSequence("order_number_seq", {
  startWith: 100001,
})

export type ShippingAddressSnapshot = {
  fullName: string
  phone: string
  line1: string
  line2?: string | null
  landmark?: string | null
  city: string
  region?: string | null
  stateCode?: string | null
  postalCode: string
  countryCode: string
}

/**
 * An order and its full pricing snapshot (doc/05 §7). Every amount is
 * integer paise; the CHECKs keep the totals and the payment split
 * consistent whatever code writes them.
 */
export const orders = pgTable(
  "orders",
  {
    id: primaryId(),
    orderNumber: text()
      .notNull()
      .unique()
      .default(sql`'DUIS-' || nextval('order_number_seq')`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: orderStatus().notNull().default("pending_payment"),
    paymentStatus: orderPaymentStatus().notNull().default("unpaid"),
    fulfillmentStatus: fulfillmentStatus().notNull().default("unfulfilled"),
    paymentMode: paymentMode().notNull(),
    currency: text().notNull().default("INR"),
    destinationCountry: text().notNull(),
    isExport: boolean().notNull().default(false),

    subtotalPaise: integer().notNull(),
    discountPaise: integer().notNull().default(0),
    shippingFeePaise: integer().notNull().default(0),
    codFeePaise: integer().notNull().default(0),
    taxTotalPaise: integer().notNull().default(0),
    totalPaise: integer().notNull(),
    walletAppliedPaise: integer().notNull().default(0),
    onlineAmountPaise: integer().notNull(),
    codDuePaise: integer().notNull().default(0),
    // GST on shipping and COD fees (charged with the goods).
    feeTaxRateBp: integer().notNull().default(0),
    feeTaxablePaise: integer().notNull().default(0),
    feeCgstPaise: integer().notNull().default(0),
    feeSgstPaise: integer().notNull().default(0),
    feeIgstPaise: integer().notNull().default(0),

    couponCode: citext(),
    shippingAddress: jsonb().$type<ShippingAddressSnapshot>().notNull(),
    customerName: text().notNull(),
    customerEmail: text(),
    customerPhone: text(),
    placeIdempotencyKey: text().notNull().unique(),
    quote: jsonb().notNull(),
    quoteHash: text().notNull(),

    placedAt: timestamptz().notNull().defaultNow(),
    reservationExpiresAt: timestamptz(),
    confirmedAt: timestamptz(),
    cancelledAt: timestamptz(),
    cancelReason: text(),
    expiredAt: timestamptz(),
    codCollectedAt: timestamptz(),
    reviewRequestedAt: timestamptz(),
    ...timestamps(),
  },
  (t) => [
    index("orders_user_idx").on(t.userId, t.placedAt.desc()),
    index("orders_status_idx").on(t.status, t.placedAt),
    index("orders_pending_expiry_idx")
      .on(t.reservationExpiresAt)
      .where(sql`${t.status} = 'pending_payment'`),
    check("orders_currency_check", sql`${t.currency} = 'INR'`),
    check(
      "orders_amounts_check",
      sql`${t.subtotalPaise} >= 0 and ${t.discountPaise} >= 0 and ${t.shippingFeePaise} >= 0 and ${t.codFeePaise} >= 0 and ${t.walletAppliedPaise} >= 0 and ${t.onlineAmountPaise} >= 0 and ${t.codDuePaise} >= 0`,
    ),
    check(
      "orders_total_check",
      sql`${t.totalPaise} = ${t.subtotalPaise} - ${t.discountPaise} + ${t.shippingFeePaise} + ${t.codFeePaise}`,
    ),
    check(
      "orders_split_check",
      sql`${t.walletAppliedPaise} + ${t.onlineAmountPaise} + ${t.codDuePaise} = ${t.totalPaise}`,
    ),
    check(
      "orders_cod_check",
      sql`${t.paymentMode} = 'partial_cod' or ${t.codDuePaise} = 0`,
    ),
    check(
      "orders_export_check",
      sql`${t.isExport} = (${t.destinationCountry} <> 'IN') and (not ${t.isExport} or ${t.paymentMode} = 'prepaid')`,
    ),
  ],
)

export const orderItems = pgTable(
  "order_items",
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    variantId: uuid().references(() => productVariants.id, {
      onDelete: "set null",
    }),
    productId: uuid().references(() => products.id, { onDelete: "set null" }),
    sku: text().notNull(),
    title: text().notNull(),
    variantLabel: text().notNull(),
    imageKey: text(),
    hsnCode: text().notNull(),
    unitPricePaise: integer().notNull(),
    unitMrpPaise: integer().notNull(),
    quantity: integer().notNull(),
    discountPaise: integer().notNull().default(0),
    lineTotalPaise: integer().notNull(),
    taxRateBp: integer().notNull(),
    taxablePaise: integer().notNull(),
    cgstPaise: integer().notNull().default(0),
    sgstPaise: integer().notNull().default(0),
    igstPaise: integer().notNull().default(0),
    exchangedQuantity: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId, t.position),
    index("order_items_variant_idx").on(t.variantId),
    check(
      "order_items_line_check",
      sql`${t.quantity} > 0 and ${t.discountPaise} >= 0 and ${t.lineTotalPaise} = ${t.unitPricePaise} * ${t.quantity} - ${t.discountPaise}`,
    ),
    check(
      "order_items_tax_check",
      sql`${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise} = ${t.lineTotalPaise}`,
    ),
  ],
)

export const orderDiscounts = pgTable(
  "order_discounts",
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    discountId: uuid().references(() => discounts.id, {
      onDelete: "set null",
    }),
    couponId: uuid().references(() => coupons.id, { onDelete: "set null" }),
    label: text().notNull(),
    amountPaise: integer().notNull(),
    // Amount per order line position: { "0": 1200, "1": 800 }.
    allocation: jsonb().$type<Record<string, number>>().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index("order_discounts_order_idx").on(t.orderId)],
)

/** Append-only (UPDATE/DELETE revoked from the app role). */
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    field: orderHistoryField().notNull(),
    fromValue: text(),
    toValue: text().notNull(),
    actorType: text().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    reason: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index("order_status_history_order_idx").on(t.orderId, t.createdAt)],
)

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: primaryId(),
    couponId: uuid()
      .notNull()
      .references(() => coupons.id, { onDelete: "restrict" }),
    orderId: uuid()
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    amountPaise: integer().notNull(),
    status: couponRedemptionStatus().notNull().default("active"),
    ...timestamps(),
  },
  (t) => [index("coupon_redemptions_user_idx").on(t.couponId, t.userId)],
)

export const remittanceSource = pgEnum("remittance_source", [
  "api",
  "csv",
  "manual",
])

/**
 * Cash the courier collected on delivery and paid over (doc/03 §2). One row
 * per order: a second import of the same remittance is a no-op.
 */
export const codRemittances = pgTable(
  "cod_remittances",
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "restrict" }),
    // No foreign key: shipments are declared in shipping.ts, which imports this file.
    shipmentId: uuid(),
    amountPaise: integer().notNull(),
    remittedAt: timestamptz().notNull(),
    utr: text().notNull(),
    source: remittanceSource().notNull(),
    batchRef: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("cod_remittances_utr_idx").on(t.utr),
    check("cod_remittances_amount_check", sql`${t.amountPaise} > 0`),
  ],
)

/** Internal staff notes on an order; never shown to the customer. */
export const orderNotes = pgTable(
  "order_notes",
  {
    id: primaryId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    authorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    body: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("order_notes_order_idx").on(t.orderId, t.createdAt),
    check(
      "order_notes_body_check",
      sql`char_length(${t.body}) between 1 and 2000`,
    ),
  ],
)

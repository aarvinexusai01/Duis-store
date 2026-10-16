import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import {
  advanceShipment,
  scheduleShipmentRetry,
  type ShipmentStatus,
} from "@/features/shipping"
import type { Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import {
  lockExchange,
  notifyCustomer,
  requireStatus,
  setStatus,
  type ExchangeStatus,
} from "./core"
import {
  approveInTransaction,
  closeBeforePickup,
  failQcInTransaction,
  passQcInTransaction,
  REASON_LABEL,
} from "./service"

/**
 * Staff exchange desk (doc/06 Phase 5 §1): approve or reject, mark the
 * returned item received, and pass or fail it at QC. Support decides,
 * fulfilment processes (doc/permissions.md).
 */

export const EXCHANGES_PAGE_SIZE = 50
const exchangeNumber = z.string().regex(/^EX-\d{6,}$/)

const VARIANT_LABEL = sql`(select string_agg(av.label, ' / ' order by pa.position)
  from variant_attribute_values vav
  join attribute_values av on av.id = vav.attribute_value_id
  left join product_attributes pa on pa.product_id = v.product_id and pa.attribute_id = vav.attribute_id
  where vav.variant_id = v.id)`

export type AdminExchangeRow = {
  exchangeNumber: string
  orderNumber: string
  customerName: string
  item: string
  replacement: string
  status: ExchangeStatus
  reason: string
  priceDifferencePaise: number
  createdAt: Date
}

export const adminListExchanges = defineOperation({
  name: "exchanges.adminList",
  access: { exchange: ["read"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    status: z
      .enum([
        "requested",
        "awaiting_payment",
        "approved",
        "rejected",
        "cancelled",
        "pickup_scheduled",
        "picked_up",
        "received",
        "qc_passed",
        "qc_failed",
        "replacement_shipped",
        "completed",
      ])
      .optional(),
    open: z.boolean().optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, input) {
    const like = input.q ? `%${input.q.replace(/[%_\\]/g, "\\$&")}%` : null
    const rows = await getDb().execute<{
      exchange_number: string
      order_number: string
      customer_name: string
      title: string
      variant_label: string
      new_label: string | null
      status: ExchangeStatus
      reason: string
      price_difference_paise: number
      created_at: Date
      total: number
    }>(sql`
      select e.exchange_number, o.order_number, o.customer_name, oi.title, oi.variant_label,
             ${VARIANT_LABEL} as new_label, e.status, e.reason, e.price_difference_paise, e.created_at,
             count(*) over ()::int as total
      from exchange_requests e
      join orders o on o.id = e.order_id
      join order_items oi on oi.id = e.order_item_id
      join product_variants v on v.id = e.requested_variant_id
      where true
        ${input.status ? sql`and e.status = ${input.status}` : sql``}
        ${input.open ? sql`and e.status not in ('rejected', 'cancelled', 'completed', 'qc_failed')` : sql``}
        ${like ? sql`and (e.exchange_number ilike ${like} or o.order_number ilike ${like} or o.customer_name ilike ${like})` : sql``}
      order by e.created_at desc
      limit ${EXCHANGES_PAGE_SIZE} offset ${(input.page - 1) * EXCHANGES_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r): AdminExchangeRow => ({
        exchangeNumber: r.exchange_number,
        orderNumber: r.order_number,
        customerName: r.customer_name,
        item: `${r.title} (${r.variant_label})`,
        replacement: r.new_label ?? "",
        status: r.status,
        reason: REASON_LABEL[r.reason] ?? r.reason,
        priceDifferencePaise: r.price_difference_paise,
        createdAt: new Date(r.created_at),
      })),
    }
  },
})

export type AdminExchangeDetail = AdminExchangeRow & {
  quantity: number
  customerNote: string | null
  decisionNote: string | null
  qcNote: string | null
  available: number
  photoIds: string[]
  paymentStatus: string | null
  parcels: {
    id: string
    direction: "reverse" | "replacement"
    status: ShipmentStatus
    awb: string | null
    courierName: string | null
    hasLabel: boolean
    lastError: string | null
  }[]
}

export const adminGetExchange = defineOperation({
  name: "exchanges.adminGet",
  access: { exchange: ["read"] },
  input: z.object({ exchangeNumber }),
  async handler({ actor }, input): Promise<AdminExchangeDetail> {
    const list = await adminListExchanges(actor, { q: input.exchangeNumber })
    const base = list.rows.find(
      (r) => r.exchangeNumber === input.exchangeNumber,
    )
    if (!base) throw new DomainError("NOT_FOUND", "Exchange not found.")
    const db = getDb()
    const [detail, photos, parcels] = await Promise.all([
      db.execute<{
        quantity: number
        customer_note: string | null
        decision_note: string | null
        qc_note: string | null
        available: number
        payment_status: string | null
      }>(sql`
        select e.quantity, e.customer_note, e.decision_note, e.qc_note,
          coalesce((select sum(l.on_hand - l.reserved) from inventory_levels l where l.variant_id = e.requested_variant_id), 0)::int as available,
          (select status::text from payments where id = e.difference_payment_id) as payment_status
        from exchange_requests e where e.exchange_number = ${input.exchangeNumber}`),
      db.execute<{ photo_id: string }>(sql`
        select ep.photo_id from exchange_request_photos ep
        join exchange_requests e on e.id = ep.exchange_id where e.exchange_number = ${input.exchangeNumber}`),
      db.execute<{
        id: string
        direction: "reverse" | "replacement"
        status: ShipmentStatus
        awb: string | null
        courier_name: string | null
        label_file_key: string | null
        last_error: string | null
      }>(sql`
        select s.id, s.direction, s.status, s.awb, s.courier_name, s.label_file_key, s.last_error
        from shipments s join exchange_requests e on e.id = s.exchange_id
        where e.exchange_number = ${input.exchangeNumber} order by s.created_at`),
    ])
    const d = detail.rows[0]!
    return {
      ...base,
      quantity: d.quantity,
      customerNote: d.customer_note,
      decisionNote: d.decision_note,
      qcNote: d.qc_note,
      available: d.available,
      photoIds: photos.rows.map((p) => p.photo_id),
      paymentStatus: d.payment_status,
      parcels: parcels.rows.map((p) => ({
        id: p.id,
        direction: p.direction,
        status: p.status,
        awb: p.awb,
        courierName: p.courier_name,
        hasLabel: Boolean(p.label_file_key),
        lastError: p.last_error,
      })),
    }
  },
})

/** Runs a step, audits it, then books any parcel it created. */
async function step(
  actor: Actor,
  number: string,
  action: string,
  work: (
    tx: Transaction,
    row: Awaited<ReturnType<typeof lockExchange>>,
  ) => Promise<string | null | void>,
  changes?: Record<string, unknown>,
) {
  const parcelId = await withTransaction(async (tx) => {
    const row = await lockExchange(tx, { number })
    const parcel = await work(tx, row)
    await writeAudit(tx, actor, {
      action,
      entityType: "exchange",
      entityId: row.id,
      changes,
    })
    return parcel ?? null
  })
  if (parcelId) {
    const result = await advanceShipment(parcelId, actor)
    if (result.status === "failed") await scheduleShipmentRetry(parcelId)
    return { parcel: result.status }
  }
  return { parcel: null }
}

export const approveExchange = defineOperation({
  name: "exchanges.approve",
  access: { exchange: ["decide"] },
  input: z.object({
    exchangeNumber,
    note: z.string().trim().max(300).optional(),
  }),
  async handler({ actor }, input) {
    return step(actor, input.exchangeNumber, "exchange.approve", (tx, row) =>
      approveInTransaction(tx, row, actor, input.note),
    )
  },
})

export const rejectExchange = defineOperation({
  name: "exchanges.reject",
  access: { exchange: ["decide"] },
  input: z.object({
    exchangeNumber,
    note: z.string().trim().min(3, "Tell the customer why.").max(300),
  }),
  async handler({ actor }, input) {
    return step(
      actor,
      input.exchangeNumber,
      "exchange.reject",
      async (tx, row) => {
        await closeBeforePickup(tx, row, "rejected", actor, input.note)
        await notifyCustomer(tx, row, "We can't do this exchange", input.note)
      },
      { note: input.note },
    )
  },
})

/** For a return the courier delivered without a final scan. */
export const markExchangeReceived = defineOperation({
  name: "exchanges.markReceived",
  access: { exchange: ["process"] },
  input: z.object({ exchangeNumber }),
  async handler({ actor }, input) {
    return step(
      actor,
      input.exchangeNumber,
      "exchange.mark_received",
      async (tx, row) => {
        requireStatus(
          row,
          ["pickup_scheduled", "picked_up"],
          "Only a collected return can be marked received.",
        )
        await setStatus(tx, row, "received")
      },
    )
  },
})

export const passExchangeQc = defineOperation({
  name: "exchanges.passQc",
  access: { exchange: ["process"] },
  input: z.object({
    exchangeNumber,
    note: z.string().trim().max(300).optional(),
  }),
  async handler({ actor }, input) {
    return step(actor, input.exchangeNumber, "exchange.qc_pass", (tx, row) =>
      passQcInTransaction(tx, row, actor, input.note),
    )
  },
})

export const failExchangeQc = defineOperation({
  name: "exchanges.failQc",
  access: { exchange: ["process"] },
  input: z.object({
    exchangeNumber,
    note: z
      .string()
      .trim()
      .min(3, "Tell the customer what was wrong.")
      .max(300),
  }),
  async handler({ actor }, input) {
    return step(
      actor,
      input.exchangeNumber,
      "exchange.qc_fail",
      (tx, row) => failQcInTransaction(tx, row, actor, input.note),
      { note: input.note },
    )
  },
})

import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { csvRecords, parseIndianDate, rupeesToPaise } from "@/lib/csv"
import { formatPaise } from "@/lib/money"
import type { Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { lockOrder, recordChange } from "./lifecycle"

/**
 * COD remittances (owner decision 2026-10-16: a generic CSV import until the
 * Shiprocket remittance API is verified). Each row names a parcel (AWB) or an
 * order, the amount, the bank reference (UTR) and the date. A row is matched
 * only if the amount is exactly the cash due; anything else is listed back.
 */

const PICK = {
  awb: ["awb", "awb_no", "awb_number", "awb_code", "tracking_number"],
  order: ["order_number", "order_no", "order_id", "order", "channel_order_id"],
  amount: ["amount", "cod_amount", "remitted_amount", "cod", "amount_remitted"],
  utr: [
    "utr",
    "utr_no",
    "utr_number",
    "bank_reference",
    "reference",
    "transaction_id",
  ],
  date: [
    "remitted_on",
    "remittance_date",
    "remitted_at",
    "payment_date",
    "date",
  ],
} as const

function pick(record: Record<string, string>, keys: readonly string[]) {
  for (const key of keys) if (record[key]) return record[key]
  return ""
}

export type RemittanceProblem = {
  line: number
  reference: string
  reason: string
}

type Outcome = "matched" | "already" | RemittanceProblem

async function applyRow(
  actor: Actor,
  line: number,
  record: Record<string, string>,
  batchRef: string | null,
): Promise<Outcome> {
  const awb = pick(record, PICK.awb)
  // Courier sheets carry our parcel id (DUIS-100150-1): drop the suffix.
  const orderNo = pick(record, PICK.order)
    .toUpperCase()
    .replace(/^(DUIS-\d{6,})-\d+$/, "$1")
  const reference = awb || orderNo || "(blank)"
  const problem = (reason: string): RemittanceProblem => ({
    line,
    reference,
    reason,
  })
  const amount = rupeesToPaise(pick(record, PICK.amount))
  const utr = pick(record, PICK.utr).slice(0, 60)
  const date = parseIndianDate(pick(record, PICK.date))
  if (!awb && !orderNo) return problem("No AWB or order number.")
  if (amount === null || amount <= 0)
    return problem("The amount isn't a number.")
  if (!utr) return problem("The UTR (bank reference) is missing.")
  if (!date)
    return problem("The date isn't a date (use YYYY-MM-DD or DD/MM/YYYY).")

  return withTransaction(async (tx): Promise<Outcome> => {
    const found = await tx.execute<{
      order_id: string
      shipment_id: string | null
    }>(
      awb
        ? sql`select order_id, id as shipment_id from shipments where awb = ${awb}`
        : sql`select id as order_id, null as shipment_id from orders where order_number = ${orderNo}`,
    )
    const target = found.rows[0]
    if (!target) return problem("No parcel or order with this reference.")
    const order = await lockOrder(tx, target.order_id)
    const existing = await tx.execute<{ utr: string }>(
      sql`select utr from cod_remittances where order_id = ${order.id}`,
    )
    if (existing.rows[0]) {
      return existing.rows[0].utr === utr
        ? "already"
        : problem(`Already settled with UTR ${existing.rows[0].utr}.`)
    }
    if (order.payment_mode !== "partial_cod" || order.cod_due_paise === 0)
      return problem("This order had no cash on delivery.")
    if (order.status !== "delivered")
      return problem("The parcel isn't delivered yet.")
    if (amount !== order.cod_due_paise) {
      return problem(
        `Amount ${formatPaise(amount)} doesn't match the cash due ${formatPaise(order.cod_due_paise)}.`,
      )
    }
    await tx.execute(sql`
      insert into cod_remittances (order_id, shipment_id, amount_paise, remitted_at, utr, source, batch_ref, created_by)
      values (${order.id}, ${target.shipment_id}, ${amount}, ${date}, ${utr}, 'csv', ${batchRef},
              ${actor.kind === "user" ? actor.userId : null})`)
    const next =
      order.payment_status === "partially_paid" ? "paid" : order.payment_status
    await tx.execute(sql`
      update orders set cod_collected_at = ${date}, payment_status = ${next}::order_payment_status, updated_at = now()
      where id = ${order.id}`)
    await recordChange(tx, order.id, {
      field: "payment_status",
      from: order.payment_status,
      to: next,
      actor,
      reason: `cod_remitted:${utr}`,
    })
    return "matched"
  })
}

export const importCodRemittances = defineOperation({
  name: "orders.importCodRemittances",
  access: { order: ["read_financials", "update"] },
  input: z.object({
    csv: z
      .string()
      .min(1, "Choose a CSV file.")
      .max(1_000_000, "The file is too large (1 MB at most)."),
    batchRef: z.string().trim().max(100).optional(),
  }),
  async handler({ actor }, input) {
    const records = csvRecords(input.csv)
    if (records.length === 0)
      throw new DomainError("VALIDATION_FAILED", "The file has no rows.")
    if (records.length > 5000)
      throw new DomainError(
        "VALIDATION_FAILED",
        "Import at most 5,000 rows at a time.",
      )
    let matched = 0
    let already = 0
    const problems: RemittanceProblem[] = []
    for (const [index, record] of records.entries()) {
      // Line numbers as a spreadsheet shows them (the header is line 1).
      const outcome = await applyRow(
        actor,
        index + 2,
        record,
        input.batchRef ?? null,
      )
      if (outcome === "matched") matched += 1
      else if (outcome === "already") already += 1
      else problems.push(outcome)
    }
    await withTransaction((tx) =>
      writeAudit(tx, actor, {
        action: "cod.import_remittances",
        entityType: "cod_remittance",
        changes: {
          rows: records.length,
          matched,
          already,
          problems: problems.length,
          batchRef: input.batchRef,
        },
      }),
    )
    return { rows: records.length, matched, already, problems }
  },
})

export const listCodOutstanding = defineOperation({
  name: "orders.listCodOutstanding",
  access: { order: ["read_financials"] },
  input: z.object({}),
  async handler() {
    const db = getDb()
    const [due, recent] = await Promise.all([
      db.execute<{
        order_number: string
        customer_name: string
        cod_due_paise: number
        awb: string | null
        delivered_at: Date | null
      }>(sql`
        select o.order_number, o.customer_name, o.cod_due_paise, s.awb, s.delivered_at
        from orders o
        left join shipments s on s.order_id = o.id and s.status = 'delivered'
        where o.payment_mode = 'partial_cod' and o.status = 'delivered' and o.cod_collected_at is null
        order by s.delivered_at nulls last limit 500`),
      db.execute<{
        order_number: string
        amount_paise: number
        utr: string
        remitted_at: Date
        source: string
      }>(sql`
        select o.order_number, r.amount_paise, r.utr, r.remitted_at, r.source
        from cod_remittances r join orders o on o.id = r.order_id
        order by r.created_at desc limit 50`),
    ])
    return {
      outstanding: due.rows.map((r) => ({
        orderNumber: r.order_number,
        customerName: r.customer_name,
        codDuePaise: r.cod_due_paise,
        awb: r.awb,
        deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
      })),
      outstandingPaise: due.rows.reduce((s, r) => s + r.cod_due_paise, 0),
      recent: recent.rows.map((r) => ({
        orderNumber: r.order_number,
        amountPaise: r.amount_paise,
        utr: r.utr,
        remittedAt: new Date(r.remitted_at),
        source: r.source,
      })),
    }
  },
})

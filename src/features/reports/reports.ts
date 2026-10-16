import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { csvCell } from "@/lib/csv"
import { getDb } from "@/server/db/client"
import { defineOperation } from "@/server/operation"

/**
 * Reports (doc/06 Phase 4 §13). Days are IST. A sale counts from the day its
 * payment was confirmed; cancelled and unpaid orders are not sales.
 */

const range = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => r.from <= r.to, {
    path: ["to"],
    message: "The end is before the start.",
  })
  .refine(
    (r) =>
      (new Date(r.to).getTime() - new Date(r.from).getTime()) / 86_400_000 <=
      400,
    { path: ["from"], message: "Choose at most 400 days." },
  )

const IN_RANGE = (from: string, to: string) => sql`
  o.confirmed_at >= (${from}::date)::timestamp at time zone 'Asia/Kolkata'
  and o.confirmed_at < (${to}::date + 1)::timestamp at time zone 'Asia/Kolkata'`
const SOLD = sql`o.status not in ('pending_payment', 'expired', 'cancelled')`

export type SalesReport = {
  totals: {
    orders: number
    units: number
    grossPaise: number
    discountPaise: number
    feesPaise: number
    taxPaise: number
    totalPaise: number
    refundedPaise: number
  }
  byDay: {
    day: string
    orders: number
    units: number
    totalPaise: number
    discountPaise: number
    taxPaise: number
  }[]
  byCategory: { category: string; units: number; revenuePaise: number }[]
}

export const salesReport = defineOperation({
  name: "reports.sales",
  access: { report: ["read"] },
  input: range,
  async handler(_ctx, { from, to }): Promise<SalesReport> {
    const db = getDb()
    const [days, categories, refunds] = await Promise.all([
      db.execute<{
        day: string
        orders: number
        units: number
        gross: number
        discount: number
        fees: number
        tax: number
        total: number
      }>(sql`
        select to_char(o.confirmed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
               count(*)::int as orders,
               coalesce(sum((select sum(quantity) from order_items where order_id = o.id)), 0)::int as units,
               coalesce(sum(o.subtotal_paise), 0)::int as gross,
               coalesce(sum(o.discount_paise), 0)::int as discount,
               coalesce(sum(o.shipping_fee_paise + o.cod_fee_paise), 0)::int as fees,
               coalesce(sum(o.tax_total_paise), 0)::int as tax,
               coalesce(sum(o.total_paise), 0)::int as total
        from orders o where ${SOLD} and ${IN_RANGE(from, to)}
        group by 1 order by 1`),
      db.execute<{
        category: string | null
        units: number
        revenue: number
      }>(sql`
        select c.name as category, sum(oi.quantity)::int as units, sum(oi.line_total_paise)::int as revenue
        from orders o
        join order_items oi on oi.order_id = o.id
        left join product_categories pc on pc.product_id = oi.product_id and pc.is_primary
        left join categories c on c.id = pc.category_id
        where ${SOLD} and ${IN_RANGE(from, to)}
        group by 1 order by revenue desc`),
      db.execute<{ refunded: number }>(sql`
        select coalesce(sum(amount_paise), 0)::int as refunded from refunds
        where status = 'processed'
          and updated_at >= (${from}::date)::timestamp at time zone 'Asia/Kolkata'
          and updated_at < (${to}::date + 1)::timestamp at time zone 'Asia/Kolkata'`),
    ])
    const sum = (key: keyof (typeof days.rows)[number]) =>
      days.rows.reduce((s, r) => s + Number(r[key]), 0)
    return {
      totals: {
        orders: sum("orders"),
        units: sum("units"),
        grossPaise: sum("gross"),
        discountPaise: sum("discount"),
        feesPaise: sum("fees"),
        taxPaise: sum("tax"),
        totalPaise: sum("total"),
        refundedPaise: refunds.rows[0]!.refunded,
      },
      byDay: days.rows.map((r) => ({
        day: r.day,
        orders: r.orders,
        units: r.units,
        totalPaise: r.total,
        discountPaise: r.discount,
        taxPaise: r.tax,
      })),
      byCategory: categories.rows.map((r) => ({
        category: r.category ?? "(no category)",
        units: r.units,
        revenuePaise: r.revenue,
      })),
    }
  },
})

const rupees = (paise: number) => (paise / 100).toFixed(2)
const toCsv = (header: string[], rows: (string | number | null)[][]) =>
  [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
  "\r\n"

/**
 * The generic GST export (owner decision 2026-10-16): one row per order line,
 * plus one row per order for shipping and COD charges, with the fields an
 * invoicing tool needs. Rows of an order add up to its total. The SAC code
 * for courier charges (9968) is for your CA to confirm (doc/10 A14).
 */
export const exportGstCsv = defineOperation({
  name: "reports.exportGst",
  access: { report: ["export"] },
  input: range,
  async handler(_ctx, { from, to }) {
    const rows = await getDb().execute<{
      order_number: string
      day: string
      status: string
      customer_name: string
      place: string
      is_export: boolean
      intra: boolean
      line_type: "goods" | "charges"
      sku: string | null
      description: string
      code: string
      quantity: number | null
      unit_price: number | null
      discount: number
      taxable: number
      rate_bp: number
      cgst: number
      sgst: number
      igst: number
      line_total: number
    }>(sql`
      with sold as (
        select o.*, to_char(o.confirmed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
               case when o.is_export then o.destination_country
                    else coalesce(o.shipping_address->>'stateCode', 'IN') end as place,
               (not o.is_export and o.shipping_address->>'stateCode' = s.registered_state_code) as intra
        from orders o cross join store_settings s
        where s.id = 1 and ${SOLD} and ${IN_RANGE(from, to)}
      )
      select order_number, day, status, customer_name, place, is_export, intra, 'goods' as line_type,
             oi.sku, oi.title || ' (' || oi.variant_label || ')' as description, oi.hsn_code as code,
             oi.quantity, oi.unit_price_paise as unit_price, oi.discount_paise as discount,
             oi.taxable_paise as taxable, oi.tax_rate_bp as rate_bp, oi.cgst_paise as cgst,
             oi.sgst_paise as sgst, oi.igst_paise as igst, oi.line_total_paise as line_total,
             sold.confirmed_at, oi.position
      from sold join order_items oi on oi.order_id = sold.id
      union all
      select order_number, day, status, customer_name, place, is_export, intra, 'charges',
             null, 'Shipping and COD charges', '9968', null, null, 0,
             fee_taxable_paise, fee_tax_rate_bp, fee_cgst_paise, fee_sgst_paise, fee_igst_paise,
             shipping_fee_paise + cod_fee_paise, confirmed_at, 10000
      from sold where shipping_fee_paise + cod_fee_paise > 0
      order by confirmed_at, order_number, position`)
    const csv = toCsv(
      [
        "order_number",
        "order_date",
        "order_status",
        "customer_name",
        "place_of_supply",
        "supply_type",
        "line_type",
        "sku",
        "description",
        "hsn_sac",
        "quantity",
        "unit_price",
        "discount",
        "taxable_value",
        "gst_rate_percent",
        "cgst",
        "sgst",
        "igst",
        "line_total",
      ],
      rows.rows.map((r) => [
        r.order_number,
        r.day,
        r.status,
        r.customer_name,
        r.place,
        r.is_export ? "export" : r.intra ? "intra_state" : "inter_state",
        r.line_type,
        r.sku,
        r.description,
        r.code,
        r.quantity,
        r.unit_price === null ? null : rupees(r.unit_price),
        rupees(r.discount),
        rupees(r.taxable),
        (r.rate_bp / 100).toFixed(2),
        rupees(r.cgst),
        rupees(r.sgst),
        rupees(r.igst),
        rupees(r.line_total),
      ]),
    )
    return {
      filename: `duis-gst-${from}-to-${to}.csv`,
      csv,
      rows: rows.rows.length,
    }
  },
})

export const exportSalesCsv = defineOperation({
  name: "reports.exportSales",
  access: { report: ["export"] },
  input: range,
  async handler({ actor }, input) {
    const report = await salesReport(actor, input)
    return {
      filename: `duis-sales-${input.from}-to-${input.to}.csv`,
      csv: toCsv(
        ["date", "orders", "units", "discount", "gst", "total"],
        report.byDay.map((d) => [
          d.day,
          d.orders,
          d.units,
          rupees(d.discountPaise),
          rupees(d.taxPaise),
          rupees(d.totalPaise),
        ]),
      ),
    }
  },
})

export type CodReport = {
  remitted: {
    orderNumber: string
    awb: string | null
    amountPaise: number
    utr: string
    remittedAt: Date
    source: string
  }[]
  remittedPaise: number
  outstandingPaise: number
  outstandingOrders: number
}

export const codRemittanceReport = defineOperation({
  name: "reports.cod",
  access: { report: ["read"] },
  input: range,
  async handler(_ctx, { from, to }): Promise<CodReport> {
    const db = getDb()
    const [remitted, outstanding] = await Promise.all([
      db.execute<{
        order_number: string
        awb: string | null
        amount_paise: number
        utr: string
        remitted_at: Date
        source: string
      }>(sql`
        select o.order_number, s.awb, r.amount_paise, r.utr, r.remitted_at, r.source
        from cod_remittances r join orders o on o.id = r.order_id
        left join shipments s on s.id = r.shipment_id
        where r.remitted_at >= (${from}::date)::timestamp at time zone 'Asia/Kolkata'
          and r.remitted_at < (${to}::date + 1)::timestamp at time zone 'Asia/Kolkata'
        order by r.remitted_at`),
      db.execute<{ amount: number; orders: number }>(sql`
        select coalesce(sum(cod_due_paise), 0)::int as amount, count(*)::int as orders from orders
        where payment_mode = 'partial_cod' and status = 'delivered' and cod_collected_at is null`),
    ])
    return {
      remitted: remitted.rows.map((r) => ({
        orderNumber: r.order_number,
        awb: r.awb,
        amountPaise: r.amount_paise,
        utr: r.utr,
        remittedAt: new Date(r.remitted_at),
        source: r.source,
      })),
      remittedPaise: remitted.rows.reduce((s, r) => s + r.amount_paise, 0),
      outstandingPaise: outstanding.rows[0]!.amount,
      outstandingOrders: outstanding.rows[0]!.orders,
    }
  },
})

export const exportCodCsv = defineOperation({
  name: "reports.exportCod",
  access: { report: ["export"] },
  input: range,
  async handler({ actor }, input) {
    const report = await codRemittanceReport(actor, input)
    return {
      filename: `duis-cod-${input.from}-to-${input.to}.csv`,
      csv: toCsv(
        ["order_number", "awb", "amount", "utr", "remitted_on", "source"],
        report.remitted.map((r) => [
          r.orderNumber,
          r.awb,
          rupees(r.amountPaise),
          r.utr,
          r.remittedAt.toLocaleDateString("en-CA", {
            timeZone: "Asia/Kolkata",
          }),
          r.source,
        ]),
      ),
    }
  },
})

import "server-only"
import { z } from "zod"

import { adminListProducts } from "@/features/catalog"
import { adminListCustomers } from "@/features/customers"
import { adminListStock } from "@/features/inventory"
import { adminListOrders, ORDER_STATUSES, ORDER_VIEWS } from "@/features/orders"
import { csvCell } from "@/lib/csv"
import { defineOperation } from "@/server/operation"

/**
 * CSV downloads of the admin lists (moved from 4a to 4c). Each export pages
 * through the same operation as the list on screen, so the filters, the
 * permissions and the hidden money columns are exactly the same.
 */

const MAX_PAGES = 200
const toCsv = (header: string[], rows: (string | number | null)[][]) =>
  [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
  "\r\n"
const rupees = (paise: number | null) =>
  paise === null ? null : (paise / 100).toFixed(2)
const day = (date: Date) =>
  date.toLocaleString("en-CA", { timeZone: "Asia/Kolkata", hour12: false })

async function allPages<T>(
  load: (page: number) => Promise<{ rows: T[]; total: number }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await load(page)
    rows.push(...result.rows)
    if (rows.length >= result.total || result.rows.length === 0) break
  }
  return rows
}

const stamp = () => new Date().toISOString().slice(0, 10)

export const exportOrdersCsv = defineOperation({
  name: "reports.exportOrders",
  access: { order: ["read", "export"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    status: ORDER_STATUSES.optional(),
    paymentMode: z.enum(["prepaid", "partial_cod"]).optional(),
    view: z.enum(ORDER_VIEWS).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  }),
  async handler({ actor }, input) {
    const rows = await allPages((page) =>
      adminListOrders(actor, { ...input, page }),
    )
    return {
      filename: `duis-orders-${stamp()}.csv`,
      csv: toCsv(
        [
          "order_number",
          "placed_at",
          "customer",
          "status",
          "payment_status",
          "payment_mode",
          "export",
          "items",
          "total",
          "parcel_status",
          "awb",
        ],
        rows.map((r) => [
          r.orderNumber,
          day(r.placedAt),
          r.customerName,
          r.status,
          r.paymentStatus,
          r.paymentMode,
          r.isExport ? "yes" : "no",
          r.itemCount,
          rupees(r.totalPaise),
          r.shipmentStatus,
          r.awb,
        ]),
      ),
    }
  },
})

export const exportCustomersCsv = defineOperation({
  name: "reports.exportCustomers",
  access: { customer: ["read"], report: ["export"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    codBlocked: z.boolean().optional(),
  }),
  async handler({ actor }, input) {
    const rows = await allPages((page) =>
      adminListCustomers(actor, { ...input, page }),
    )
    return {
      filename: `duis-customers-${stamp()}.csv`,
      csv: toCsv(
        ["name", "email", "phone", "orders", "spent", "cod_blocked", "joined"],
        rows.map((r) => [
          r.name,
          r.email,
          r.phone,
          r.orderCount,
          rupees(r.spentPaise),
          r.codBlocked ? "yes" : "no",
          day(r.joinedAt),
        ]),
      ),
    }
  },
})

export const exportProductsCsv = defineOperation({
  name: "reports.exportProducts",
  access: { catalog: ["read"], report: ["export"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(["draft", "active", "archived"]).optional(),
    categoryId: z.uuid().optional(),
  }),
  async handler({ actor }, input) {
    const rows = await allPages((page) =>
      adminListProducts(actor, { ...input, page }),
    )
    return {
      filename: `duis-products-${stamp()}.csv`,
      csv: toCsv(
        [
          "title",
          "slug",
          "status",
          "variants",
          "on_hand",
          "available",
          "min_price",
          "max_price",
          "updated",
        ],
        rows.map((r) => [
          r.title,
          r.slug,
          r.status,
          r.variantCount,
          r.onHand,
          r.available,
          rupees(r.minPricePaise),
          rupees(r.maxPricePaise),
          day(r.updatedAt),
        ]),
      ),
    }
  },
})

export const exportInventoryCsv = defineOperation({
  name: "reports.exportInventory",
  access: { inventory: ["read"], report: ["export"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    lowOnly: z.boolean().default(false),
  }),
  async handler({ actor }, input) {
    const rows = await allPages((page) =>
      adminListStock(actor, { ...input, page }),
    )
    return {
      filename: `duis-inventory-${stamp()}.csv`,
      csv: toCsv(
        [
          "sku",
          "product",
          "variant",
          "status",
          "on_hand",
          "reserved",
          "available",
          "alert_at",
        ],
        rows.map((r) => [
          r.sku,
          r.title,
          r.label,
          r.status,
          r.onHand,
          r.reserved,
          r.available,
          r.threshold,
        ]),
      ),
    }
  },
})

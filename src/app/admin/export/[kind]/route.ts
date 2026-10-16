import { connection, type NextRequest } from "next/server"

import {
  exportCodCsv,
  exportCustomersCsv,
  exportGstCsv,
  exportInventoryCsv,
  exportOrdersCsv,
  exportProductsCsv,
  exportSalesCsv,
} from "@/features/reports"
import type { Actor } from "@/server/auth/actor"
import { getActor } from "@/server/auth/session"
import { isDomainError } from "@/server/errors"

type Exporter = (
  actor: Actor,
  params: URLSearchParams,
) => Promise<{ filename: string; csv: string }>

const text = (params: URLSearchParams, key: string) =>
  params.get(key)?.trim() || undefined

/** Each list's export takes the same URL parameters as the list page. */
const EXPORTS: Record<string, Exporter> = {
  orders: (actor, p) =>
    exportOrdersCsv(actor, {
      q: text(p, "q"),
      status: text(p, "status") as never,
      paymentMode: text(p, "paymentMode") as never,
      view: text(p, "view") as never,
      from: text(p, "from"),
      to: text(p, "to"),
    }),
  customers: (actor, p) =>
    exportCustomersCsv(actor, {
      q: text(p, "q"),
      codBlocked: p.get("cod") ? p.get("cod") === "blocked" : undefined,
    }),
  products: (actor, p) =>
    exportProductsCsv(actor, {
      q: text(p, "q"),
      status: text(p, "status") as never,
      categoryId: text(p, "categoryId"),
    }),
  inventory: (actor, p) =>
    exportInventoryCsv(actor, {
      q: text(p, "q"),
      lowOnly: p.get("low") === "1",
    }),
  gst: (actor, p) =>
    exportGstCsv(actor, { from: p.get("from") ?? "", to: p.get("to") ?? "" }),
  sales: (actor, p) =>
    exportSalesCsv(actor, { from: p.get("from") ?? "", to: p.get("to") ?? "" }),
  cod: (actor, p) =>
    exportCodCsv(actor, { from: p.get("from") ?? "", to: p.get("to") ?? "" }),
}

/**
 * CSV downloads for staff. The operation checks permissions and validates
 * the parameters; anyone not allowed gets a 404, like the rest of /admin.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/admin/export/[kind]">,
) {
  await connection()
  const { kind } = await params
  const exporter = EXPORTS[kind]
  if (!exporter) return new Response(null, { status: 404 })
  try {
    const { filename, csv } = await exporter(
      await getActor(),
      request.nextUrl.searchParams,
    )
    // The byte-order mark makes Excel read the file as UTF-8 (₹, names).
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    })
  } catch (error) {
    if (!isDomainError(error)) throw error
    return error.code === "VALIDATION_FAILED"
      ? new Response("Check the dates and filters.", { status: 400 })
      : new Response(null, { status: 404 })
  }
}

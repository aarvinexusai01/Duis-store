import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { DataTable, type Column } from "@/components/admin/data-table"
import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ADMIN_ORDERS_PAGE_SIZE,
  ORDER_VIEWS,
  adminListOrders,
  type AdminOrderRow,
} from "@/features/orders"
import { bulkShipAction } from "@/features/orders/admin-actions"
import { can, requireStaff } from "@/features/staff"
import { choice, one, pageOf, withParams } from "@/lib/admin-query"
import { formatPaise } from "@/lib/money"
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
} from "@/lib/order-status"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Orders" }

const STATUSES = [
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
] as const
const VIEW_LABEL: Record<(typeof ORDER_VIEWS)[number], string> = {
  to_ship: "To ship",
  in_transit: "In transit",
  cod_pending: "COD to collect",
  rto: "Returns (RTO)",
}
const DATE = /^\d{4}-\d{2}-\d{2}$/

export default function OrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  )
}

async function Orders({
  searchParams,
}: Pick<PageProps<"/admin/orders">, "searchParams">) {
  const actor = await requireStaff("/admin/orders")
  if (!can(actor, { order: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const from = one(raw.from)
  const to = one(raw.to)
  const params = {
    q: one(raw.q),
    status: choice(one(raw.status), STATUSES),
    paymentMode: choice(one(raw.paymentMode), [
      "prepaid",
      "partial_cod",
    ] as const),
    view: choice(one(raw.view), ORDER_VIEWS),
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
  }
  const page = pageOf(raw)
  const list = await adminListOrders(actor, { ...params, page })
  const canShip = can(actor, { order: ["fulfil"] })
  const money = can(actor, { order: ["read_financials"] })

  const columns: Column<AdminOrderRow>[] = [
    {
      key: "order",
      header: "Order",
      cell: (row) => (
        <Link
          href={`/admin/orders/${row.orderNumber}` as Route}
          className="font-medium hover:underline"
        >
          {row.orderNumber}
        </Link>
      ),
    },
    {
      key: "placed",
      header: "Placed",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) =>
        row.placedAt.toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Kolkata",
        }),
    },
    { key: "customer", header: "Customer", cell: (row) => row.customerName },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge tone={ORDER_STATUS_TONE[row.status]}>
          {ORDER_STATUS_LABEL[row.status] ?? row.status}
        </StatusBadge>
      ),
    },
    {
      key: "payment",
      header: "Payment",
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge tone={PAYMENT_STATUS_TONE[row.paymentStatus]}>
            {PAYMENT_STATUS_LABEL[row.paymentStatus] ?? row.paymentStatus}
          </StatusBadge>
          {row.paymentMode === "partial_cod" && (
            <StatusBadge tone="neutral">COD</StatusBadge>
          )}
          {row.isExport && <StatusBadge tone="neutral">Export</StatusBadge>}
        </span>
      ),
    },
    {
      key: "parcel",
      header: "Parcel",
      cell: (row) =>
        row.shipmentStatus ? (
          <span className="flex flex-col items-start">
            <StatusBadge tone={SHIPMENT_STATUS_TONE[row.shipmentStatus]}>
              {SHIPMENT_STATUS_LABEL[row.shipmentStatus]}
            </StatusBadge>
            {row.awb && (
              <span className="mt-0.5 font-mono text-xs text-muted-foreground">
                {row.awb}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "items",
      header: "Items",
      className: "text-right",
      cell: (row) => row.itemCount,
    },
    ...(money
      ? [
          {
            key: "total",
            header: "Total",
            className: "text-right whitespace-nowrap",
            cell: (row: AdminOrderRow) =>
              row.totalPaise === null ? "—" : formatPaise(row.totalPaise),
          },
        ]
      : []),
  ]

  const dateInput =
    "h-9 rounded-sm border border-input bg-card px-2 text-sm text-foreground"
  return (
    <>
      <AdminPageHeader title="Orders" description={`${list.total} orders`} />
      <nav aria-label="Order views" className="mb-4 flex flex-wrap gap-2">
        {[undefined, ...ORDER_VIEWS].map((view) => (
          <Link
            key={view ?? "all"}
            href={withParams("/admin/orders", { view }) as Route}
            aria-current={params.view === view ? "page" : undefined}
            className={cn(
              "rounded-sm border px-3 py-1 text-sm",
              params.view === view
                ? "border-ink bg-ink text-paper"
                : "bg-card hover:bg-secondary",
            )}
          >
            {view ? VIEW_LABEL[view] : "All"}
          </Link>
        ))}
      </nav>
      <DataTable
        rows={list.rows}
        columns={columns}
        rowKey={(row) => row.orderNumber}
        total={list.total}
        page={page}
        pageSize={ADMIN_ORDERS_PAGE_SIZE}
        basePath="/admin/orders"
        params={params}
        search={{ placeholder: "Order, customer, phone or AWB" }}
        filters={[
          {
            name: "status",
            label: "Status",
            options: STATUSES.map((s) => ({
              value: s,
              label: ORDER_STATUS_LABEL[s]!,
            })),
          },
          {
            name: "paymentMode",
            label: "Payment",
            options: [
              { value: "prepaid", label: "Prepaid" },
              { value: "partial_cod", label: "Partial COD" },
            ],
          },
        ]}
        fields={
          <>
            {params.view && (
              <input type="hidden" name="view" value={params.view} />
            )}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input
                type="date"
                name="from"
                defaultValue={params.from}
                className={dateInput}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input
                type="date"
                name="to"
                defaultValue={params.to}
                className={dateInput}
              />
            </label>
          </>
        }
        bulk={
          canShip
            ? {
                action: bulkShipAction,
                buttons: [{ value: "ship", label: "Book parcels" }],
              }
            : undefined
        }
        empty="No orders match."
      />
    </>
  )
}

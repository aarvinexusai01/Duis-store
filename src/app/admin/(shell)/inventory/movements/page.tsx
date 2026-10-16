import type { Metadata } from "next"
import { Suspense } from "react"

import { DataTable, type Column } from "@/components/admin/data-table"
import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  adminListMovements,
  STOCK_PAGE_SIZE,
  type MovementRow,
} from "@/features/inventory"
import { can, requireStaff } from "@/features/staff"
import { pageOf } from "@/lib/admin-query"

export const metadata: Metadata = { title: "Stock movements" }

const REASONS: Record<string, string> = {
  receive: "Received",
  adjust: "Correction",
  sale: "Sold",
  cancel_restock: "Cancelled order",
  exchange_out: "Exchange sent",
  exchange_in: "Exchange returned",
  rto_restock: "Returned to us",
  damaged: "Damaged",
  count_correction: "Stock count",
}

export default function MovementsPage({
  searchParams,
}: PageProps<"/admin/inventory/movements">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Movements searchParams={searchParams} />
    </Suspense>
  )
}

async function Movements({
  searchParams,
}: Pick<PageProps<"/admin/inventory/movements">, "searchParams">) {
  const actor = await requireStaff("/admin/inventory/movements")
  if (!can(actor, { inventory: ["read"] })) return <NoAccess />
  const page = pageOf(await searchParams)
  const list = await adminListMovements(actor, { page })
  const columns: Column<MovementRow>[] = [
    {
      key: "at",
      header: "When",
      className: "whitespace-nowrap",
      cell: (r) =>
        r.at.toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
    },
    {
      key: "item",
      header: "Item",
      cell: (r) => (
        <>
          <span className="font-medium">{r.title}</span>{" "}
          <span className="font-mono text-xs text-muted-foreground">
            {r.sku}
          </span>
        </>
      ),
    },
    {
      key: "delta",
      header: "Change",
      className: "text-right",
      cell: (r) => (
        <StatusBadge tone={r.delta > 0 ? "good" : "bad"}>
          {r.delta > 0 ? `+${r.delta}` : r.delta}
        </StatusBadge>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (r) => REASONS[r.reason] ?? r.reason,
    },
    {
      key: "by",
      header: "By",
      cell: (r) =>
        r.actor ?? (r.reference ? `System (${r.reference})` : "System"),
    },
    {
      key: "note",
      header: "Note",
      className: "text-muted-foreground",
      cell: (r) => r.note,
    },
  ]
  return (
    <>
      <AdminPageHeader
        title="Stock movements"
        description="Every change to on-hand stock, newest first. This history can't be edited."
        back={{ href: "/admin/inventory", label: "Inventory" }}
      />
      <DataTable
        rows={list.rows}
        columns={columns}
        rowKey={(r) => r.id}
        total={list.total}
        page={page}
        pageSize={STOCK_PAGE_SIZE}
        basePath="/admin/inventory/movements"
        params={{}}
      />
    </>
  )
}

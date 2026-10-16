import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { DataTable, type Column } from "@/components/admin/data-table"
import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  adminListStock,
  STOCK_PAGE_SIZE,
  type StockRow,
} from "@/features/inventory"
import { can, requireStaff } from "@/features/staff"
import { one, pageOf } from "@/lib/admin-query"
import { cn } from "@/lib/utils"

import { StockRowActions } from "./stock-row-actions"

export const metadata: Metadata = { title: "Inventory" }

export default function InventoryPage({
  searchParams,
}: PageProps<"/admin/inventory">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Inventory searchParams={searchParams} />
    </Suspense>
  )
}

async function Inventory({
  searchParams,
}: Pick<PageProps<"/admin/inventory">, "searchParams">) {
  const actor = await requireStaff("/admin/inventory")
  if (!can(actor, { inventory: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const params = { q: one(raw.q), low: one(raw.low) === "1" ? "1" : undefined }
  const page = pageOf(raw)
  const list = await adminListStock(actor, {
    q: params.q,
    lowOnly: params.low === "1",
    page,
  })
  const canAdjust = can(actor, { inventory: ["adjust"] })

  const columns: Column<StockRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <Link
          href={`/admin/products/${row.productId}` as Route}
          className="hover:underline"
        >
          <span className="font-medium">{row.title}</span>{" "}
          <span className="text-muted-foreground">{row.label}</span>
        </Link>
      ),
    },
    {
      key: "sku",
      header: "SKU",
      cell: (row) => <span className="font-mono text-xs">{row.sku}</span>,
    },
    {
      key: "onHand",
      header: "On hand",
      className: "text-right tabular-nums",
      cell: (row) => row.onHand,
    },
    {
      key: "reserved",
      header: "Reserved",
      className: "text-right tabular-nums text-muted-foreground",
      cell: (row) => row.reserved,
    },
    {
      key: "available",
      header: "Available",
      className: "text-right",
      cell: (row) => (
        <StatusBadge
          tone={
            row.available <= 0
              ? "bad"
              : row.available <= row.threshold
                ? "warn"
                : "good"
          }
        >
          {row.available}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) =>
        canAdjust ? (
          <StockRowActions
            variantId={row.variantId}
            label={`${row.title} ${row.label}`}
            onHand={row.onHand}
            reserved={row.reserved}
            threshold={row.threshold}
          />
        ) : null,
    },
  ]

  return (
    <>
      <AdminPageHeader
        title="Inventory"
        description="Stock at the default warehouse. Reserved units are held for orders awaiting payment."
        actions={
          <Link
            href="/admin/inventory/movements"
            className={cn(buttonVariants({ variant: "outline" }), "rounded-sm")}
          >
            Movement history
          </Link>
        }
      />
      <DataTable
        rows={list.rows}
        columns={columns}
        rowKey={(row) => row.variantId}
        total={list.total}
        page={page}
        pageSize={STOCK_PAGE_SIZE}
        basePath="/admin/inventory"
        params={params}
        search={{ placeholder: "SKU or product" }}
        filters={[
          {
            name: "low",
            label: "Show",
            options: [{ value: "1", label: "Low stock only" }],
          },
        ]}
        empty="Nothing matches."
      />
    </>
  )
}

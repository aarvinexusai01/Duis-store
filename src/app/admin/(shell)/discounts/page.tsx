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
  ADMIN_DISCOUNTS_PAGE_SIZE,
  adminListDiscounts,
  type AdminDiscountRow,
} from "@/features/discounts"
import { can, requireStaff } from "@/features/staff"
import { choice, one, pageOf } from "@/lib/admin-query"
import { formatPaise } from "@/lib/money"
import { cn } from "@/lib/utils"

import { describeValue } from "./_components/format"

export const metadata: Metadata = { title: "Discounts" }

const STATUS_TONE = {
  active: "good",
  paused: "warn",
  archived: "neutral",
} as const

export default function DiscountsPage({
  searchParams,
}: PageProps<"/admin/discounts">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Discounts searchParams={searchParams} />
    </Suspense>
  )
}

async function Discounts({
  searchParams,
}: Pick<PageProps<"/admin/discounts">, "searchParams">) {
  const actor = await requireStaff("/admin/discounts")
  if (!can(actor, { discount: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const params = {
    q: one(raw.q),
    kind: choice(one(raw.kind), ["automatic", "coupon"] as const),
    status: choice(one(raw.status), ["active", "paused", "archived"] as const),
  }
  const page = pageOf(raw)
  const list = await adminListDiscounts(actor, { ...params, page })

  const columns: Column<AdminDiscountRow>[] = [
    {
      key: "name",
      header: "Discount",
      cell: (row) => (
        <Link
          href={`/admin/discounts/${row.id}` as Route}
          className="font-medium hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "codes",
      header: "Code",
      cell: (row) =>
        row.kind === "automatic" ? (
          <span className="text-muted-foreground">Automatic</span>
        ) : (
          <span className="font-mono text-xs">
            {row.firstCode}
            {row.codeCount > 1 && ` +${row.codeCount - 1}`}
          </span>
        ),
    },
    {
      key: "value",
      header: "Value",
      cell: (row) => describeValue(row.valueType, row.value),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <span className="flex gap-1">
          <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
          {row.status === "active" && row.timing && (
            <StatusBadge tone={row.timing === "ended" ? "neutral" : "info"}>
              {row.timing}
            </StatusBadge>
          )}
        </span>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      className: "text-right",
      cell: (row) => row.orders,
    },
    {
      key: "given",
      header: "Discount given",
      className: "text-right whitespace-nowrap",
      cell: (row) => formatPaise(row.discountPaise),
    },
  ]

  return (
    <>
      <AdminPageHeader
        title="Discounts"
        description={`${list.total} discounts`}
        actions={
          can(actor, { discount: ["create"] }) && (
            <Link
              href="/admin/discounts/new"
              className={cn(buttonVariants(), "rounded-sm")}
            >
              New discount
            </Link>
          )
        }
      />
      <DataTable
        rows={list.rows}
        columns={columns}
        rowKey={(row) => row.id}
        total={list.total}
        page={page}
        pageSize={ADMIN_DISCOUNTS_PAGE_SIZE}
        basePath="/admin/discounts"
        params={params}
        search={{ placeholder: "Name or code" }}
        filters={[
          {
            name: "kind",
            label: "Type",
            options: [
              { value: "automatic", label: "Automatic" },
              { value: "coupon", label: "Coupon" },
            ],
          },
          {
            name: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "archived", label: "Archived" },
            ],
          },
        ]}
        empty="No discounts match."
      />
    </>
  )
}

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
  adminListExchanges,
  EXCHANGES_PAGE_SIZE,
  type AdminExchangeRow,
} from "@/features/exchanges"
import { can, requireStaff } from "@/features/staff"
import { choice, one, pageOf } from "@/lib/admin-query"
import { EXCHANGE_STATUS_LABEL, EXCHANGE_STATUS_TONE } from "@/lib/order-status"
import { formatPaise } from "@/lib/money"

export const metadata: Metadata = { title: "Exchanges" }

const STATUSES = Object.keys(
  EXCHANGE_STATUS_LABEL,
) as (keyof typeof EXCHANGE_STATUS_LABEL)[]

export default function ExchangesPage({
  searchParams,
}: PageProps<"/admin/exchanges">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Exchanges searchParams={searchParams} />
    </Suspense>
  )
}

async function Exchanges({
  searchParams,
}: Pick<PageProps<"/admin/exchanges">, "searchParams">) {
  const actor = await requireStaff("/admin/exchanges")
  if (!can(actor, { exchange: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const params = {
    q: one(raw.q),
    status: choice(one(raw.status), STATUSES),
  }
  const page = pageOf(raw)
  const list = await adminListExchanges(actor, {
    q: params.q,
    status: params.status,
    open: params.status ? undefined : true,
    page,
  })

  const columns: Column<AdminExchangeRow>[] = [
    {
      key: "exchange",
      header: "Exchange",
      cell: (row) => (
        <Link
          href={`/admin/exchanges/${row.exchangeNumber}` as Route}
          className="font-medium hover:underline"
        >
          {row.exchangeNumber}
        </Link>
      ),
    },
    { key: "order", header: "Order", cell: (row) => row.orderNumber },
    { key: "customer", header: "Customer", cell: (row) => row.customerName },
    {
      key: "item",
      header: "Item → wanted",
      cell: (row) => (
        <span>
          {row.item}
          <span className="block text-muted-foreground">
            → {row.replacement}
          </span>
        </span>
      ),
    },
    { key: "reason", header: "Reason", cell: (row) => row.reason },
    {
      key: "difference",
      header: "Difference",
      className: "text-right whitespace-nowrap",
      cell: (row) =>
        row.priceDifferencePaise === 0
          ? "—"
          : row.priceDifferencePaise > 0
            ? `+${formatPaise(row.priceDifferencePaise)}`
            : `−${formatPaise(-row.priceDifferencePaise)}`,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge tone={EXCHANGE_STATUS_TONE[row.status]}>
          {EXCHANGE_STATUS_LABEL[row.status]}
        </StatusBadge>
      ),
    },
  ]

  return (
    <>
      <AdminPageHeader
        title="Exchanges"
        description={
          params.status
            ? `${list.total} exchanges`
            : `${list.total} open exchanges (choose a status to see closed ones)`
        }
      />
      <DataTable
        id="exchanges"
        rows={list.rows}
        columns={columns}
        rowKey={(row) => row.exchangeNumber}
        total={list.total}
        page={page}
        pageSize={EXCHANGES_PAGE_SIZE}
        basePath="/admin/exchanges"
        params={params}
        search={{ placeholder: "Exchange, order or customer" }}
        filters={[
          {
            name: "status",
            label: "Status",
            options: STATUSES.map((s) => ({
              value: s,
              label: EXCHANGE_STATUS_LABEL[s],
            })),
          },
        ]}
        empty="No exchanges here."
      />
    </>
  )
}

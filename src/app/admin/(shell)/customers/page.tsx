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
  ADMIN_CUSTOMERS_PAGE_SIZE,
  adminListCustomers,
  type AdminCustomerRow,
} from "@/features/customers"
import { can, requireStaff } from "@/features/staff"
import { choice, one, pageOf } from "@/lib/admin-query"
import { formatPaise } from "@/lib/money"

export const metadata: Metadata = { title: "Customers" }

export default function CustomersPage({
  searchParams,
}: PageProps<"/admin/customers">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  )
}

async function Customers({
  searchParams,
}: Pick<PageProps<"/admin/customers">, "searchParams">) {
  const actor = await requireStaff("/admin/customers")
  if (!can(actor, { customer: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const params = {
    q: one(raw.q),
    cod: choice(one(raw.cod), ["blocked", "allowed"] as const),
  }
  const page = pageOf(raw)
  const list = await adminListCustomers(actor, {
    q: params.q,
    codBlocked: params.cod ? params.cod === "blocked" : undefined,
    page,
  })
  const money = can(actor, { order: ["read_financials"] })

  const columns: Column<AdminCustomerRow>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (row) => (
        <Link
          href={`/admin/customers/${row.id}` as Route}
          className="font-medium hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (row) => (
        <span className="text-muted-foreground">
          {[row.email, row.phone].filter(Boolean).join(" · ")}
        </span>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      className: "text-right",
      cell: (row) => row.orderCount,
    },
    ...(money
      ? [
          {
            key: "spent",
            header: "Spent",
            className: "text-right whitespace-nowrap",
            cell: (row: AdminCustomerRow) =>
              row.spentPaise === null ? "—" : formatPaise(row.spentPaise),
          },
        ]
      : []),
    {
      key: "cod",
      header: "COD",
      cell: (row) =>
        row.codBlocked ? <StatusBadge tone="bad">Blocked</StatusBadge> : null,
    },
    {
      key: "joined",
      header: "Joined",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) =>
        row.joinedAt.toLocaleDateString("en-IN", {
          dateStyle: "medium",
          timeZone: "Asia/Kolkata",
        }),
    },
  ]

  return (
    <>
      <AdminPageHeader
        title="Customers"
        description={`${list.total} customers`}
      />
      <DataTable
        rows={list.rows}
        columns={columns}
        rowKey={(row) => row.id}
        total={list.total}
        page={page}
        pageSize={ADMIN_CUSTOMERS_PAGE_SIZE}
        basePath="/admin/customers"
        params={params}
        search={{ placeholder: "Name, email or phone" }}
        filters={[
          {
            name: "cod",
            label: "COD",
            options: [
              { value: "blocked", label: "Blocked" },
              { value: "allowed", label: "Allowed" },
            ],
          },
        ]}
        empty="No customers match."
      />
    </>
  )
}

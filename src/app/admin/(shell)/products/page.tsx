import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { DataTable, type Column } from "@/components/admin/data-table"
import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { MediaThumb } from "@/components/media-thumb"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ADMIN_PAGE_SIZE,
  adminCatalogOptions,
  adminListProducts,
  type AdminProductRow,
} from "@/features/catalog"
import { bulkProductAction } from "@/features/catalog/admin-actions"
import { can, requireStaff } from "@/features/staff"
import { choice, one, pageOf } from "@/lib/admin-query"
import { formatPaise } from "@/lib/money"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Products" }

const STATUS_TONE = {
  draft: "neutral",
  active: "good",
  archived: "bad",
} as const

export default function ProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Products searchParams={searchParams} />
    </Suspense>
  )
}

async function Products({
  searchParams,
}: Pick<PageProps<"/admin/products">, "searchParams">) {
  const actor = await requireStaff("/admin/products")
  if (!can(actor, { catalog: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const params = {
    q: one(raw.q),
    status: choice(one(raw.status), ["draft", "active", "archived"] as const),
    categoryId: one(raw.categoryId),
  }
  const page = pageOf(raw)
  const [list, options] = await Promise.all([
    adminListProducts(actor, { ...params, page }),
    adminCatalogOptions(actor, {}),
  ])
  const canCreate = can(actor, { catalog: ["create"] })
  const canPublish = can(actor, { catalog: ["publish", "archive"] })

  const columns: Column<AdminProductRow>[] = [
    {
      key: "product",
      header: "Product",
      cell: (row) => (
        <Link
          href={`/admin/products/${row.id}` as Route}
          className="flex items-center gap-3 hover:underline"
        >
          <MediaThumb mediaKey={row.imageKey} size={36} />
          <span className="font-medium">{row.title}</span>
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
      ),
    },
    {
      key: "variants",
      header: "Variants",
      cell: (row) => row.variantCount,
      className: "text-right",
    },
    {
      key: "stock",
      header: "Available",
      className: "text-right",
      cell: (row) => (
        <span className={row.available <= 0 ? "text-destructive" : ""}>
          {row.available}
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      className: "text-right whitespace-nowrap",
      cell: (row) =>
        row.minPricePaise === null
          ? "—"
          : row.minPricePaise === row.maxPricePaise
            ? formatPaise(row.minPricePaise)
            : `${formatPaise(row.minPricePaise)}–${formatPaise(row.maxPricePaise!)}`,
    },
    {
      key: "updated",
      header: "Updated",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) =>
        row.updatedAt.toLocaleDateString("en-IN", {
          dateStyle: "medium",
          timeZone: "Asia/Kolkata",
        }),
    },
  ]

  return (
    <>
      <AdminPageHeader
        title="Products"
        description={`${list.total} products`}
        actions={
          canCreate && (
            <Link
              href="/admin/products/new"
              className={cn(buttonVariants(), "rounded-sm")}
            >
              New product
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
        pageSize={ADMIN_PAGE_SIZE}
        basePath="/admin/products"
        params={params}
        search={{ placeholder: "Title, slug or SKU" }}
        filters={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "draft", label: "Draft" },
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ],
          },
          {
            name: "categoryId",
            label: "Category",
            options: options.categories.map((c) => ({
              value: c.id,
              label: `${"— ".repeat(c.depth)}${c.name}`,
            })),
          },
        ]}
        bulk={
          canPublish
            ? {
                action: bulkProductAction,
                buttons: [
                  { value: "publish", label: "Publish" },
                  { value: "archive", label: "Archive", destructive: true },
                ],
              }
            : undefined
        }
        empty="No products match."
      />
    </>
  )
}

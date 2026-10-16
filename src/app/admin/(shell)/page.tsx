import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { RevenueChart } from "@/components/admin/bar-chart"
import { AdminPageHeader, StatusBadge } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListStock } from "@/features/inventory"
import { operationsSummary, salesSummary } from "@/features/reports"
import { can, requireStaff } from "@/features/staff"
import { formatPaise } from "@/lib/money"
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/order-status"

export const metadata: Metadata = { title: "Dashboard" }

export default function DashboardPage() {
  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="The last 30 days, in IST."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Dashboard />
      </Suspense>
    </>
  )
}

function Card({
  label,
  value,
  href,
}: {
  label: string
  value: string
  href?: string
}) {
  const body = (
    <div className="rounded-sm border bg-card p-4">
      <p className="text-xs text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
  return href ? (
    <Link href={href as Route} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  )
}

async function Dashboard() {
  const actor = await requireStaff("/admin")
  const showSales = can(actor, { order: ["read_financials"] })
  const showOps = can(actor, { order: ["read"] })
  const showStock = can(actor, { inventory: ["read"] })
  const [sales, ops, low] = await Promise.all([
    showSales ? salesSummary(actor, { days: 30 }) : null,
    showOps ? operationsSummary(actor, {}) : null,
    showStock ? adminListStock(actor, { lowOnly: true, page: 1 }) : null,
  ])

  if (!sales && !ops && !low) {
    return (
      <p className="text-sm text-muted-foreground">
        Welcome. Use the menu to get to your tools.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {sales && (
          <Card label="Revenue" value={formatPaise(sales.revenuePaise)} />
        )}
        {sales && <Card label="Orders" value={String(sales.orders)} />}
        {sales && (
          <Card
            label="Average order"
            value={formatPaise(sales.averageOrderPaise)}
          />
        )}
        {ops && (
          <Card
            label="To fulfil"
            value={String(ops.toFulfil)}
            href="/admin/orders?view=to_ship"
          />
        )}
        {sales && (
          <Card
            label="COD to collect"
            value={formatPaise(sales.codDuePaise)}
            href="/admin/orders/cod"
          />
        )}
        {low && (
          <Card
            label="Low-stock SKUs"
            value={String(low.total)}
            href="/admin/inventory?low=1"
          />
        )}
      </div>

      {sales && (
        <section className="rounded-sm border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Revenue per day</h2>
          <RevenueChart data={sales.daily} />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {ops && (
          <section className="rounded-sm border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Recent orders</h2>
            <ul className="divide-y text-sm">
              {ops.recent.map((order) => (
                <li
                  key={order.orderNumber}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/admin/orders/${order.orderNumber}` as Route}
                      className="font-medium hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {order.customer} ·{" "}
                      {order.placedAt.toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Kolkata",
                      })}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge tone={ORDER_STATUS_TONE[order.status]}>
                      {ORDER_STATUS_LABEL[order.status] ?? order.status}
                    </StatusBadge>
                    {order.totalPaise !== null && (
                      <span className="tabular-nums">
                        {formatPaise(order.totalPaise)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
              {ops.recent.length === 0 && (
                <li className="py-2 text-muted-foreground">No orders yet.</li>
              )}
            </ul>
          </section>
        )}
        {sales && (
          <section className="rounded-sm border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Best sellers</h2>
            <ol className="divide-y text-sm">
              {sales.bestSellers.map((item) => (
                <li
                  key={item.productId}
                  className="flex justify-between gap-3 py-2"
                >
                  <Link
                    href={`/admin/products/${item.productId}` as Route}
                    className="truncate hover:underline"
                  >
                    {item.title}
                  </Link>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {item.units} sold · {formatPaise(item.revenuePaise)}
                  </span>
                </li>
              ))}
              {sales.bestSellers.length === 0 && (
                <li className="py-2 text-muted-foreground">No sales yet.</li>
              )}
            </ol>
          </section>
        )}
        {low && (
          <section className="rounded-sm border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Low stock</h2>
            <ul className="divide-y text-sm">
              {low.rows.slice(0, 8).map((row) => (
                <li
                  key={row.variantId}
                  className="flex justify-between gap-3 py-2"
                >
                  <span className="min-w-0 truncate">
                    {row.title}{" "}
                    <span className="text-muted-foreground">{row.label}</span>
                  </span>
                  <StatusBadge tone={row.available <= 0 ? "bad" : "warn"}>
                    {row.available} left
                  </StatusBadge>
                </li>
              ))}
              {low.total === 0 && (
                <li className="py-2 text-muted-foreground">
                  Everything is above its threshold.
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

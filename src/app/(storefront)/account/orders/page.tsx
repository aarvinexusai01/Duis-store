import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { MediaThumb } from "@/components/media-thumb"
import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { listMyOrders } from "@/features/orders"
import { formatPaise } from "@/lib/money"
import { ORDER_STATUS_LABEL } from "@/lib/order-status"

export const metadata: Metadata = { title: "Orders" }

export default function OrdersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Orders />
    </Suspense>
  )
}

async function Orders() {
  const actor = await requireUser("/account/orders")
  const orders = await listMyOrders(actor, {})
  return (
    <section>
      <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
        Orders
      </h2>
      {orders.length === 0 ? (
        <p className="border border-dashed p-6 text-sm text-muted-foreground">
          You haven&apos;t placed any orders yet.
        </p>
      ) : (
        <ul className="divide-y border bg-card">
          {orders.map((order) => (
            <li key={order.orderNumber}>
              <Link
                href={`/account/orders/${order.orderNumber}` as Route}
                className="flex items-center gap-4 p-4 hover:bg-secondary"
              >
                <MediaThumb mediaKey={order.imageKey} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {order.orderNumber}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {order.placedAt.toLocaleDateString("en-IN", {
                      dateStyle: "medium",
                      timeZone: "Asia/Kolkata",
                    })}{" "}
                    · {order.itemCount}{" "}
                    {order.itemCount === 1 ? "item" : "items"}
                  </span>
                </span>
                <span className="text-right text-sm">
                  <span className="block font-semibold">
                    {formatPaise(order.totalPaise)}
                  </span>
                  <span className="text-muted-foreground">
                    {ORDER_STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

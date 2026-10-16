import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { MediaThumb } from "@/components/media-thumb"
import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { getMyOrder } from "@/features/orders"
import { formatPaise } from "@/lib/money"
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/order-status"
import { isDomainError } from "@/server/errors"

import { OrderActions } from "./order-actions"

export const metadata: Metadata = { title: "Order" }

type Props = PageProps<"/account/orders/[orderNumber]">

export default function OrderPage({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Order params={params} />
    </Suspense>
  )
}

const TIMELINE = [
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
]

async function Order({ params }: Pick<Props, "params">) {
  const { orderNumber } = await params
  const actor = await requireUser(`/account/orders/${orderNumber}`)
  const order = await getMyOrder(actor, { orderNumber }).catch((error) => {
    if (isDomainError(error)) notFound()
    throw error
  })
  const statusHistory = order.history.filter((h) => h.field === "status")
  const reachedAt = new Map(statusHistory.map((h) => [h.to, h.at]))
  const address = order.shippingAddress

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/account/orders"
            className="text-sm underline underline-offset-4"
          >
            ← All orders
          </Link>
          <h2 className="mt-2 font-display text-3xl tracking-wide uppercase">
            {order.orderNumber}
          </h2>
          <p className="text-sm text-muted-foreground">
            Placed{" "}
            {order.placedAt.toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Kolkata",
            })}{" "}
            · {ORDER_STATUS_LABEL[order.status] ?? order.status} ·{" "}
            {PAYMENT_STATUS_LABEL[order.paymentStatus]}
          </p>
        </div>
        <OrderActions
          orderNumber={order.orderNumber}
          canCancel={order.canCancel}
          canPay={order.canPay}
        />
      </div>

      {["cancelled", "expired"].includes(order.status) ? (
        <p className="border border-destructive/40 bg-card p-4 text-sm">
          {order.status === "expired"
            ? "Payment wasn't completed in time, so this order wasn't placed and nothing was charged."
            : "This order was cancelled."}
          {order.refunds.length > 0 &&
            ` Refunds: ${order.refunds.map((r) => `${formatPaise(r.amountPaise)} (${r.status})`).join(", ")}.`}
        </p>
      ) : order.status !== "pending_payment" ? (
        <ol
          className="grid grid-cols-5 gap-1 text-center text-xs"
          aria-label="Order progress"
        >
          {TIMELINE.map((step) => {
            const at = reachedAt.get(step)
            return (
              <li
                key={step}
                className={at ? "font-semibold" : "text-muted-foreground"}
              >
                <span
                  className={`mb-2 block h-1.5 ${at ? "bg-ink" : "bg-border"}`}
                />
                {ORDER_STATUS_LABEL[step]}
                {at && (
                  <span className="block font-normal text-muted-foreground">
                    {at.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      timeZone: "Asia/Kolkata",
                    })}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      ) : null}

      {order.parcel && order.status !== "cancelled" && (
        <p className="border bg-card p-4 text-sm">
          {order.status === "delivered" ? "Delivered by" : "Shipping with"}{" "}
          <strong>{order.parcel.courier ?? "our courier"}</strong>. Tracking
          number <span className="font-mono">{order.parcel.awb}</span>.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[minmax(0,1fr)_18rem]">
        <ul className="divide-y border bg-card">
          {order.items.map((item) => (
            <li key={item.sku} className="flex gap-4 p-4 text-sm">
              <MediaThumb mediaKey={item.imageKey} />
              <span className="min-w-0 flex-1">
                {item.productSlug ? (
                  <Link
                    href={`/products/${item.productSlug}` as Route}
                    className="font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <span className="font-medium">{item.title}</span>
                )}
                <span className="block text-muted-foreground">
                  {item.variantLabel} × {item.quantity}
                </span>
              </span>
              <span className="tabular-nums">
                {formatPaise(item.lineTotalPaise)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-6 text-sm">
          <dl className="space-y-1.5">
            <Row label="Subtotal" value={formatPaise(order.subtotalPaise)} />
            {order.discountPaise > 0 && (
              <Row
                label="Discounts"
                value={`−${formatPaise(order.discountPaise)}`}
              />
            )}
            <Row
              label="Shipping"
              value={
                order.shippingFeePaise
                  ? formatPaise(order.shippingFeePaise)
                  : "Free"
              }
            />
            {order.codFeePaise > 0 && (
              <Row label="COD fee" value={formatPaise(order.codFeePaise)} />
            )}
            <Row label="Total" value={formatPaise(order.totalPaise)} strong />
            {order.walletAppliedPaise > 0 && (
              <Row
                label="Wallet"
                value={formatPaise(order.walletAppliedPaise)}
              />
            )}
            <Row
              label="Paid online"
              value={formatPaise(order.onlineAmountPaise)}
            />
            {order.codDuePaise > 0 && (
              <Row
                label="Cash on delivery"
                value={formatPaise(order.codDuePaise)}
                strong
              />
            )}
          </dl>
          <div>
            <h3 className="mb-1 font-semibold">Delivery address</h3>
            <p className="text-muted-foreground">
              {address.fullName}
              <br />
              {[address.line1, address.line2].filter(Boolean).join(", ")}
              <br />
              {address.city} {address.postalCode}, {address.countryCode}
              <br />
              {address.phone}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

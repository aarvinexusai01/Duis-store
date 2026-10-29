import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { buttonVariants } from "@/components/ui/button"
import { SHOP_HREF } from "@/config/routes"
import { purchaseEventId } from "@/features/analytics"
import { TrackEvent } from "@/features/analytics/ui/track-event"
import { requireUser } from "@/features/auth/session-guard"
import { getMyOrder } from "@/features/orders"
import { formatPaise } from "@/lib/money"
import { cn } from "@/lib/utils"
import { isDomainError } from "@/server/errors"

import { AutoRefresh, RefreshOnce } from "./auto-refresh"

export const metadata: Metadata = { title: "Order placed" }

type Props = PageProps<"/checkout/success/[orderNumber]">

export default function SuccessPage({ params }: Props) {
  return (
    <>
      <RefreshOnce />
      <Suspense fallback={<PageSkeleton />}>
        <Success params={params} />
      </Suspense>
    </>
  )
}

async function Success({ params }: Pick<Props, "params">) {
  const { orderNumber } = await params
  const actor = await requireUser(`/checkout/success/${orderNumber}`)
  const order = await getMyOrder(actor, { orderNumber }).catch((error) => {
    if (isDomainError(error)) notFound()
    throw error
  })
  const orderHref = `/account/orders/${order.orderNumber}` as Route

  if (order.status === "pending_payment") {
    return (
      <div className="max-w-xl" role="status">
        <h1 className="display-heading text-5xl">Confirming your payment…</h1>
        <p className="mt-4 text-muted-foreground">
          This usually takes a few seconds. You don&apos;t need to pay again; if
          your bank already took the money, the order will confirm on its own.
        </p>
        <AutoRefresh />
        <Link href={orderHref} className="mt-6 inline-block underline">
          View order {order.orderNumber}
        </Link>
      </div>
    )
  }
  if (order.status === "cancelled" || order.status === "expired") {
    return (
      <div className="max-w-xl">
        <h1 className="display-heading text-5xl">Order not placed</h1>
        <p className="mt-4">
          Order {order.orderNumber} couldn&apos;t be completed. Any money taken
          is being refunded.
        </p>
        <Link
          href={orderHref}
          className={cn(buttonVariants(), "mt-6 h-11 rounded-none px-6")}
        >
          View details
        </Link>
      </div>
    )
  }
  return (
    <div className="max-w-xl">
      <TrackEvent
        onceKey={`purchase:${order.orderNumber}`}
        event={{
          name: "purchase",
          orderNumber: order.orderNumber,
          eventId: purchaseEventId(order.orderNumber),
          valuePaise: order.totalPaise,
          taxPaise: order.taxTotalPaise,
          shippingPaise: order.shippingFeePaise,
          ...(order.couponCode ? { coupon: order.couponCode } : {}),
          items: order.items
            .filter((item) => item.productId)
            .map((item) => ({
              id: item.productId!,
              name: item.title,
              variant: item.sku,
              pricePaise: item.unitPricePaise,
              quantity: item.quantity,
            })),
        }}
      />
      <p className="text-sm font-semibold tracking-wider text-rust uppercase">
        Thank you
      </p>
      <h1 className="mt-2 display-heading text-5xl sm:text-6xl">
        Order confirmed
      </h1>
      <p className="mt-4 text-lg">
        Order <strong>{order.orderNumber}</strong> is confirmed. We&apos;ve
        emailed the details.
      </p>
      <dl className="mt-6 space-y-2 border bg-card p-5 text-sm">
        <div className="flex justify-between">
          <dt>Total</dt>
          <dd className="font-semibold">{formatPaise(order.totalPaise)}</dd>
        </div>
        {order.codDuePaise > 0 && (
          <div className="flex justify-between">
            <dt>Pay in cash on delivery</dt>
            <dd className="font-semibold">{formatPaise(order.codDuePaise)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt>Deliver to</dt>
          <dd className="text-right">
            {order.shippingAddress.fullName}, {order.shippingAddress.city}{" "}
            {order.shippingAddress.postalCode}
          </dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={orderHref}
          className={cn(buttonVariants(), "h-11 rounded-none px-6")}
        >
          View order
        </Link>
        <Link
          href={SHOP_HREF}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-11 rounded-none px-6",
          )}
        >
          Keep shopping
        </Link>
      </div>
    </div>
  )
}

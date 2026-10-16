import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { getExchangeOptions } from "@/features/exchanges"
import { formatPaise } from "@/lib/money"
import { isDomainError } from "@/server/errors"

import { ExchangeActions, ExchangeForm } from "./exchange-form"

export const metadata: Metadata = { title: "Exchange an item" }

type Props = PageProps<"/account/orders/[orderNumber]/exchange">

const STATUS: Record<string, string> = {
  requested: "Waiting for approval",
  awaiting_payment: "Approved: pay the difference",
  approved: "Approved: booking pickup",
  rejected: "Not approved",
  cancelled: "Cancelled",
  pickup_scheduled: "Pickup booked",
  picked_up: "Collected",
  received: "Received: checking it",
  qc_passed: "Accepted: packing your replacement",
  qc_failed: "Not accepted: being returned to you",
  replacement_shipped: "Replacement on its way",
  completed: "Completed",
}

export default function ExchangePage({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Exchange params={params} />
    </Suspense>
  )
}

async function Exchange({ params }: Pick<Props, "params">) {
  const { orderNumber } = await params
  const actor = await requireUser(`/account/orders/${orderNumber}/exchange`)
  const data = await getExchangeOptions(actor, { orderNumber }).catch(
    (error) => {
      if (isDomainError(error)) notFound()
      throw error
    },
  )
  const eligible = data.items.filter((item) => item.eligible)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href={`/account/orders/${orderNumber}` as Route}
          className="text-sm underline underline-offset-4"
        >
          ← Order {orderNumber}
        </Link>
        <h2 className="mt-2 font-display text-3xl tracking-wide uppercase">
          Exchange an item
        </h2>
        <p className="text-sm text-muted-foreground">
          Another size or colour of the same product. Pickup is free; if the new
          option costs more you pay the difference, and if it costs less we add
          it to your Duis wallet.
        </p>
      </div>

      {data.exchanges.length > 0 && (
        <section aria-labelledby="your-exchanges">
          <h3 id="your-exchanges" className="mb-3 font-semibold">
            Your exchanges
          </h3>
          <ul className="divide-y border bg-card text-sm">
            {data.exchanges.map((exchange) => (
              <li
                key={exchange.exchangeNumber}
                className="flex flex-wrap items-start justify-between gap-3 p-4"
              >
                <span className="min-w-0">
                  <span className="font-medium">{exchange.exchangeNumber}</span>{" "}
                  · {STATUS[exchange.status] ?? exchange.status}
                  <span className="block text-muted-foreground">
                    {exchange.item} → {exchange.replacement} ×{" "}
                    {exchange.quantity} · {exchange.reason}
                  </span>
                  {exchange.priceDifferencePaise !== 0 && (
                    <span className="block text-muted-foreground">
                      {exchange.priceDifferencePaise > 0
                        ? `You pay ${formatPaise(exchange.priceDifferencePaise)} more`
                        : `${formatPaise(-exchange.priceDifferencePaise)} back to your wallet`}
                    </span>
                  )}
                  {(exchange.decisionNote || exchange.qcNote) &&
                    ["rejected", "qc_failed"].includes(exchange.status) && (
                      <span className="block">
                        {exchange.qcNote ?? exchange.decisionNote}
                      </span>
                    )}
                </span>
                <ExchangeActions
                  exchangeNumber={exchange.exchangeNumber}
                  canCancel={exchange.canCancel}
                  canPay={exchange.canPay}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {eligible.length > 0 ? (
        <ExchangeForm orderNumber={orderNumber} items={eligible} />
      ) : (
        <p className="border bg-card p-4 text-sm">
          {data.items[0]?.why ?? "Nothing in this order can be exchanged."}
        </p>
      )}
      {data.items.some((item) => !item.eligible) && eligible.length > 0 && (
        <ul className="text-sm text-muted-foreground">
          {data.items
            .filter((item) => !item.eligible)
            .map((item) => (
              <li key={item.orderItemId}>
                {item.title} ({item.variantLabel}): {item.why}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

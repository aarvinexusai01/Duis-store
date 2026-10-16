import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { getTracking } from "@/features/orders"
import { ORDER_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/order-status"
import { anonymousActor } from "@/server/auth/actor"
import { isDomainError } from "@/server/errors"

export const metadata: Metadata = {
  title: "Track your order",
  robots: { index: false, follow: false },
}

type Props = PageProps<"/track/[orderNumber]">

const KIND = {
  order: "Your order",
  return: "Exchange pickup",
  replacement: "Replacement",
} as const

const when = (date: Date) =>
  date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  })

/** Public parcel progress from a signed link (no sign-in, no personal data). */
export default function TrackPage({ params, searchParams }: Props) {
  return (
    <div className="page-container max-w-2xl py-10">
      <Suspense fallback={<PageSkeleton />}>
        <Track params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Track({ params, searchParams }: Props) {
  // Request-time only: the page is personal and never prerendered.
  await connection()
  const { orderNumber } = await params
  const token = (await searchParams).t
  const tracking = await getTracking(anonymousActor(), {
    orderNumber,
    token: typeof token === "string" ? token : "",
  }).catch((error) => {
    if (isDomainError(error)) notFound()
    throw error
  })

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-4xl tracking-wide uppercase">
          {tracking.orderNumber}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ORDER_STATUS_LABEL[tracking.status] ?? tracking.status} · to{" "}
          {tracking.city}
        </p>
      </div>
      {tracking.parcels.length === 0 ? (
        <p className="border bg-card p-4 text-sm">
          We&apos;re packing your order. Tracking appears here once the courier
          has it.
        </p>
      ) : (
        tracking.parcels.map((parcel) => (
          <section
            key={`${parcel.kind}-${parcel.awb}`}
            className="border bg-card p-4 text-sm"
          >
            <h2 className="font-semibold">
              {KIND[parcel.kind]}: {SHIPMENT_STATUS_LABEL[parcel.status]}
            </h2>
            <p className="text-muted-foreground">
              {parcel.courier ?? "Courier"}
              {parcel.awb && (
                <>
                  {" "}
                  · tracking number{" "}
                  <span className="font-mono">{parcel.awb}</span>
                </>
              )}
            </p>
            {parcel.events.length > 0 && (
              <ol className="mt-4 flex flex-col gap-3 border-l-2 border-ink pl-4">
                {parcel.events.map((event) => (
                  <li key={`${event.label}-${event.at.toISOString()}`}>
                    <span className="font-medium">
                      {event.status
                        ? SHIPMENT_STATUS_LABEL[event.status]
                        : event.label}
                    </span>
                    <span className="block text-muted-foreground">
                      {when(event.at)}
                      {event.location && ` · ${event.location}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))
      )}
    </div>
  )
}

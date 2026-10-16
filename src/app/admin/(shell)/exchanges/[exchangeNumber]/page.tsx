import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  adminGetExchange,
  type AdminExchangeDetail,
} from "@/features/exchanges"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"
import { formatPaise } from "@/lib/money"
import {
  EXCHANGE_STATUS_LABEL,
  EXCHANGE_STATUS_TONE,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
} from "@/lib/order-status"

import { ExchangeDesk } from "./exchange-desk"

export const metadata: Metadata = { title: "Exchange" }

export default function ExchangePage({
  params,
}: PageProps<"/admin/exchanges/[exchangeNumber]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Exchange params={params} />
    </Suspense>
  )
}

async function Exchange({
  params,
}: Pick<PageProps<"/admin/exchanges/[exchangeNumber]">, "params">) {
  const { exchangeNumber } = await params
  const actor = await requireStaff(`/admin/exchanges/${exchangeNumber}`)
  if (!can(actor, { exchange: ["read"] })) return <NoAccess />
  let exchange: AdminExchangeDetail
  try {
    exchange = await adminGetExchange(actor, { exchangeNumber })
  } catch (error) {
    if (isDomainError(error)) notFound()
    throw error
  }
  const difference = exchange.priceDifferencePaise

  return (
    <>
      <AdminPageHeader
        title={exchange.exchangeNumber}
        back={{ href: "/admin/exchanges", label: "Exchanges" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={EXCHANGE_STATUS_TONE[exchange.status]}>
              {EXCHANGE_STATUS_LABEL[exchange.status]}
            </StatusBadge>
            Order{" "}
            {can(actor, { order: ["read"] }) ? (
              <Link
                href={`/admin/orders/${exchange.orderNumber}` as Route}
                className="underline underline-offset-4"
              >
                {exchange.orderNumber}
              </Link>
            ) : (
              exchange.orderNumber
            )}{" "}
            · {exchange.customerName}
          </span>
        }
        actions={
          <ExchangeDesk
            exchangeNumber={exchange.exchangeNumber}
            status={exchange.status}
            can={{
              decide: can(actor, { exchange: ["decide"] }),
              process: can(actor, { exchange: ["process"] }),
            }}
          />
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-sm border bg-card p-4 text-sm">
          <h2 className="mb-3 font-semibold">Request</h2>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2">
            <dt className="text-muted-foreground">Returning</dt>
            <dd>
              {exchange.item} × {exchange.quantity}
            </dd>
            <dt className="text-muted-foreground">Wants</dt>
            <dd>
              {exchange.replacement}{" "}
              <span className="text-muted-foreground">
                ({exchange.available} available)
              </span>
            </dd>
            <dt className="text-muted-foreground">Reason</dt>
            <dd>{exchange.reason}</dd>
            {exchange.customerNote && (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd className="whitespace-pre-line">{exchange.customerNote}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Difference</dt>
            <dd>
              {difference === 0
                ? "None"
                : difference > 0
                  ? `Customer pays ${formatPaise(difference)}${exchange.paymentStatus ? ` (${exchange.paymentStatus})` : ""}`
                  : `${formatPaise(-difference)} to the wallet after QC`}
            </dd>
            {exchange.decisionNote && (
              <>
                <dt className="text-muted-foreground">Decision</dt>
                <dd>{exchange.decisionNote}</dd>
              </>
            )}
            {exchange.qcNote && (
              <>
                <dt className="text-muted-foreground">QC</dt>
                <dd>{exchange.qcNote}</dd>
              </>
            )}
          </dl>
          {exchange.photoIds.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {exchange.photoIds.map((id) => (
                <a
                  key={id}
                  href={`/photos/${id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, served by /photos */}
                  <img
                    src={`/photos/${id}`}
                    alt="Customer photo"
                    className="size-28 object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-sm border bg-card p-4 text-sm">
          <h2 className="mb-3 font-semibold">Parcels</h2>
          {exchange.parcels.length === 0 ? (
            <p className="text-muted-foreground">
              The free return pickup is booked once the exchange is approved
              (and any difference paid).
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {exchange.parcels.map((parcel) => (
                <li key={parcel.id}>
                  <span className="font-medium">
                    {parcel.direction === "reverse"
                      ? "Return pickup"
                      : "To customer"}
                  </span>{" "}
                  <StatusBadge tone={SHIPMENT_STATUS_TONE[parcel.status]}>
                    {SHIPMENT_STATUS_LABEL[parcel.status]}
                  </StatusBadge>
                  <span className="block text-muted-foreground">
                    {parcel.courierName ?? "Courier not assigned"}
                    {parcel.awb && ` · AWB ${parcel.awb}`}
                    {parcel.hasLabel && (
                      <>
                        {" · "}
                        <a
                          href={`/admin/shipments/${parcel.id}/label`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          label
                        </a>
                      </>
                    )}
                  </span>
                  {parcel.lastError && parcel.status === "pending" && (
                    <span className="block text-destructive">
                      {parcel.lastError}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Parcel scans (and demo scans) are on the order page.
          </p>
        </section>
      </div>
    </>
  )
}

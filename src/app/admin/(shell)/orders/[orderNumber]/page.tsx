import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense, type ReactNode } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { MediaThumb } from "@/components/media-thumb"
import { Skeleton } from "@/components/ui/skeleton"
import { adminGetOrder, type AdminOrderDetail } from "@/features/orders"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"
import { countryName } from "@/lib/countries"
import { stateName } from "@/lib/india"
import { formatPaise } from "@/lib/money"
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
} from "@/lib/order-status"
import { WALLET_REASON_LABEL } from "@/lib/wallet-reasons"

import { AddressEditor } from "./_components/address-editor"
import { NoteForm } from "./_components/note-form"
import { OrderActions } from "./_components/order-actions"
import { ParcelActions } from "./_components/parcel-actions"

export const metadata: Metadata = { title: "Order" }

const when = (date: Date) =>
  date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  })

export default function OrderPage({
  params,
}: PageProps<"/admin/orders/[orderNumber]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Order params={params} />
    </Suspense>
  )
}

async function Order({
  params,
}: Pick<PageProps<"/admin/orders/[orderNumber]">, "params">) {
  const { orderNumber } = await params
  const actor = await requireStaff(`/admin/orders/${orderNumber}`)
  if (!can(actor, { order: ["read"] })) return <NoAccess />
  let order: AdminOrderDetail
  try {
    order = await adminGetOrder(actor, { orderNumber })
  } catch (error) {
    if (isDomainError(error)) notFound()
    throw error
  }
  const allowed = {
    fulfil: can(actor, { order: ["fulfil"] }),
    cancel: can(actor, { order: ["cancel"] }),
    refund: can(actor, { order: ["refund"] }),
    update: can(actor, { order: ["update"] }),
    customer: can(actor, { customer: ["read"] }),
  }
  const a = order.shippingAddress
  const money = order.money

  return (
    <>
      <AdminPageHeader
        title={order.orderNumber}
        back={{ href: "/admin/orders", label: "Orders" }}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={ORDER_STATUS_TONE[order.status]}>
              {ORDER_STATUS_LABEL[order.status] ?? order.status}
            </StatusBadge>
            <StatusBadge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
              {PAYMENT_STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus}
            </StatusBadge>
            <StatusBadge>
              {order.paymentMode === "partial_cod" ? "Partial COD" : "Prepaid"}
            </StatusBadge>
            {order.isExport && (
              <StatusBadge tone="info">
                Export · {countryName(order.destinationCountry)}
              </StatusBadge>
            )}
            <span>Placed {when(order.placedAt)}</span>
          </span>
        }
        actions={
          <OrderActions
            orderNumber={order.orderNumber}
            can={{
              startProcessing: allowed.fulfil && order.can.startProcessing,
              ship: allowed.fulfil && order.can.ship,
              cancel: allowed.cancel && order.can.cancel,
              refund:
                allowed.refund &&
                money !== null &&
                money.refundable.toWalletPaise > 0,
            }}
            refundable={money?.refundable ?? null}
            defaultWeightGrams={
              order.items.reduce((s, i) => s + i.weightGrams * i.quantity, 0) +
              150
            }
            hasLiveParcel={order.shipments.some(
              (s) => s.status !== "cancelled",
            )}
          />
        }
      />

      {order.status === "cancelled" && order.cancelReason && (
        <Notice tone="bad">Cancelled ({order.cancelReason}).</Notice>
      )}
      {order.status === "rto_delivered" &&
        order.paymentMode === "prepaid" &&
        order.paymentStatus === "paid" && (
          <Notice tone="warn">
            The parcel came back to us. Decide what to refund to the customer
            (shipping is usually kept), then use Refund.
          </Notice>
        )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Items">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Item</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">
                      HSN
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">Qty</th>
                    {money && (
                      <>
                        <th className="py-2 pr-3 text-right font-medium">
                          Price
                        </th>
                        <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">
                          Tax
                        </th>
                        <th className="py-2 text-right font-medium">Total</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-3">
                          <MediaThumb mediaKey={item.imageKey} size={40} />
                          <span>
                            <span className="font-medium">{item.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {item.variantLabel} ·{" "}
                              <span className="font-mono">{item.sku}</span>
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="hidden py-2 pr-3 font-mono text-xs sm:table-cell">
                        {item.hsnCode}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {item.quantity}
                      </td>
                      {item.money && (
                        <>
                          <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                            {formatPaise(item.money.unitPricePaise)}
                            {item.money.discountPaise > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                −{formatPaise(item.money.discountPaise)}
                              </span>
                            )}
                          </td>
                          <td className="hidden py-2 pr-3 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
                            {item.money.taxRateBp / 100}%{" "}
                            {item.money.igstPaise > 0
                              ? `IGST ${formatPaise(item.money.igstPaise)}`
                              : `CGST+SGST ${formatPaise(item.money.cgstPaise + item.money.sgstPaise)}`}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap tabular-nums">
                            {formatPaise(item.money.lineTotalPaise)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {money && (
              <dl className="mt-4 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
                <Row
                  label="Subtotal"
                  value={formatPaise(money.subtotalPaise)}
                />
                {money.discounts.map((d) => (
                  <Row
                    key={d.label}
                    label={d.label}
                    value={`−${formatPaise(d.amountPaise)}`}
                  />
                ))}
                <Row
                  label="Shipping"
                  value={formatPaise(money.shippingFeePaise)}
                />
                {money.codFeePaise > 0 && (
                  <Row label="COD fee" value={formatPaise(money.codFeePaise)} />
                )}
                <Row
                  label="GST included"
                  value={formatPaise(money.taxTotalPaise)}
                />
                <Row
                  label="Total"
                  value={formatPaise(money.totalPaise)}
                  strong
                />
                {money.walletAppliedPaise > 0 && (
                  <Row
                    label="Paid from wallet"
                    value={formatPaise(money.walletAppliedPaise)}
                  />
                )}
                <Row
                  label="Paid online"
                  value={formatPaise(money.onlineAmountPaise)}
                />
                {money.codDuePaise > 0 && (
                  <Row
                    label="Cash on delivery"
                    value={formatPaise(money.codDuePaise)}
                  />
                )}
              </dl>
            )}
          </Panel>

          <Panel title="Parcel">
            {order.shipments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not booked yet.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {order.shipments.map((parcel) => (
                  <li key={parcel.id} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            tone={SHIPMENT_STATUS_TONE[parcel.status]}
                          >
                            {SHIPMENT_STATUS_LABEL[parcel.status]}
                          </StatusBadge>
                          <span className="font-medium">
                            {parcel.courierName ?? "Courier not assigned"}
                          </span>
                          {parcel.awb && (
                            <span className="font-mono">AWB {parcel.awb}</span>
                          )}
                          {parcel.provider === "fake" && (
                            <StatusBadge tone="warn">Demo courier</StatusBadge>
                          )}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {parcel.weightGrams} g · {parcel.dimensions}
                          {parcel.codAmountPaise !== null &&
                            parcel.codAmountPaise > 0 &&
                            ` · collect ${formatPaise(parcel.codAmountPaise)}`}
                          {parcel.pickupScheduledAt &&
                            ` · pickup ${when(parcel.pickupScheduledAt)}`}
                        </p>
                        {parcel.lastError && parcel.status === "pending" && (
                          <p className="mt-1 text-destructive">
                            Booking failed (attempt {parcel.attempts}):{" "}
                            {parcel.lastError}
                          </p>
                        )}
                        {parcel.customs && (
                          <p className="mt-1 text-muted-foreground">
                            Customs: {parcel.customs.terms},{" "}
                            {parcel.customs.lines.length} lines
                          </p>
                        )}
                      </div>
                      {allowed.fulfil && (
                        <ParcelActions
                          shipmentId={parcel.id}
                          status={parcel.status}
                          hasLabel={parcel.hasLabel}
                          canSimulate={order.can.simulate}
                        />
                      )}
                    </div>
                    {parcel.events.length > 0 && (
                      <ol className="flex flex-col gap-1 border-l pl-4 text-sm">
                        {parcel.events.map((event) => (
                          <li
                            key={`${event.providerStatus}-${event.occurredAt.toISOString()}`}
                          >
                            <span className="font-medium">
                              {event.status
                                ? SHIPMENT_STATUS_LABEL[event.status]
                                : event.providerStatus}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {when(event.occurredAt)}
                              {event.location && ` · ${event.location}`}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {money && (
            <Panel title="Payments and refunds">
              {money.payments.length === 0 && money.walletAppliedPaise === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No payments yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {money.payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap justify-between gap-2"
                    >
                      <span>
                        {p.provider === "fake" ? "Simulated" : "Razorpay"}{" "}
                        {p.purpose === "advance" ? "advance" : "payment"}
                        {p.method && ` · ${p.method}`}
                        {p.providerPaymentId && (
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            {p.providerPaymentId}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums">
                        {formatPaise(p.amountPaise)} · {p.status}
                        {p.refundedPaise > 0 &&
                          ` · refunded ${formatPaise(p.refundedPaise)}`}
                      </span>
                    </li>
                  ))}
                  {money.refunds.map((r) => (
                    <li
                      key={`${r.reason}-${r.at.toISOString()}`}
                      className="flex flex-wrap justify-between gap-2 text-muted-foreground"
                    >
                      <span>
                        Refund to payment · {r.reason}
                        {r.by && ` · by ${r.by}`}
                      </span>
                      <span className="tabular-nums">
                        −{formatPaise(r.amountPaise)} · {r.status}
                      </span>
                    </li>
                  ))}
                  {money.wallet.map((w) => (
                    <li
                      key={`${w.reason}-${w.at.toISOString()}`}
                      className="flex flex-wrap justify-between gap-2 text-muted-foreground"
                    >
                      <span>
                        Wallet · {WALLET_REASON_LABEL[w.reason] ?? w.reason}
                      </span>
                      <span className="tabular-nums">
                        {w.amountPaise > 0 ? "+" : "−"}
                        {formatPaise(Math.abs(w.amountPaise))}
                      </span>
                    </li>
                  ))}
                  {money.remittance && (
                    <li className="flex flex-wrap justify-between gap-2">
                      <span>
                        COD cash received · UTR{" "}
                        <span className="font-mono">
                          {money.remittance.utr}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatPaise(money.remittance.amountPaise)}
                      </span>
                    </li>
                  )}
                </ul>
              )}
            </Panel>
          )}

          <Panel title="History">
            <ol className="flex flex-col gap-1 text-sm">
              {order.history.map((h) => (
                <li key={`${h.field}-${h.to}-${h.at.toISOString()}`}>
                  <span className="text-muted-foreground">{when(h.at)}</span>{" "}
                  {h.field.replace("_", " ")}:{" "}
                  <span className="font-medium">{h.to.replace(/_/g, " ")}</span>
                  {h.reason && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({h.reason.replace(/_/g, " ")})
                    </span>
                  )}
                  {h.by && (
                    <span className="text-muted-foreground"> · {h.by}</span>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <Panel title="Customer">
            <p className="text-sm font-medium">
              {allowed.customer ? (
                <Link
                  href={`/admin/customers/${order.customer.userId}` as Route}
                  className="hover:underline"
                >
                  {order.customer.name}
                </Link>
              ) : (
                order.customer.name
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {[order.customer.email, order.customer.phone]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.customer.orderCount} order
              {order.customer.orderCount === 1 ? "" : "s"}
              {order.customer.codBlocked && (
                <>
                  {" · "}
                  <StatusBadge tone="bad">COD blocked</StatusBadge>
                </>
              )}
            </p>
          </Panel>
          <Panel
            title="Deliver to"
            action={
              allowed.update &&
              order.can.editAddress && (
                <AddressEditor orderNumber={order.orderNumber} address={a} />
              )
            }
          >
            <address className="text-sm leading-relaxed not-italic">
              {a.fullName}
              <br />
              {a.line1}
              {a.line2 && (
                <>
                  <br />
                  {a.line2}
                </>
              )}
              {a.landmark && (
                <>
                  <br />
                  Near {a.landmark}
                </>
              )}
              <br />
              {a.city} {a.postalCode}
              {a.region && `, ${a.region}`}
              <br />
              {a.stateCode
                ? (stateName(a.stateCode) ?? a.stateCode)
                : countryName(a.countryCode)}
              <br />
              {a.phone}
            </address>
          </Panel>
          <Panel title="Staff notes">
            <NoteForm orderNumber={order.orderNumber} />
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              {order.notes.map((note) => (
                <li key={note.at.toISOString()}>
                  <p className="whitespace-pre-wrap">{note.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {note.author ?? "Staff"} · {when(note.at)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  )
}

function Panel({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-sm border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <>
      <dt className={strong ? "font-semibold" : "text-muted-foreground"}>
        {label}
      </dt>
      <dd
        className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}
      >
        {value}
      </dd>
    </>
  )
}

function Notice({
  tone,
  children,
}: {
  tone: "bad" | "warn"
  children: ReactNode
}) {
  return (
    <p
      role="status"
      className={`mb-4 rounded-sm border p-3 text-sm ${tone === "bad" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
    >
      {children}
    </p>
  )
}

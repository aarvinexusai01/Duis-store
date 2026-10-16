import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense, type ReactNode } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  adminGetCustomer,
  type AdminCustomerDetail,
} from "@/features/customers"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"
import { formatPaise } from "@/lib/money"
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/order-status"
import { WALLET_REASON_LABEL } from "@/lib/wallet-reasons"

import { CodBlockForm, GoodwillForm } from "./customer-forms"

export const metadata: Metadata = { title: "Customer" }

const day = (date: Date) =>
  date.toLocaleDateString("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  })

export default function CustomerPage({
  params,
}: PageProps<"/admin/customers/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Customer params={params} />
    </Suspense>
  )
}

async function Customer({
  params,
}: Pick<PageProps<"/admin/customers/[id]">, "params">) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const actor = await requireStaff(`/admin/customers/${id}`)
  if (!can(actor, { customer: ["read"] })) return <NoAccess />
  let customer: AdminCustomerDetail
  try {
    customer = await adminGetCustomer(actor, { userId: id })
  } catch (error) {
    if (isDomainError(error)) notFound()
    throw error
  }
  const canOrders = can(actor, { order: ["read"] })

  return (
    <>
      <AdminPageHeader
        title={customer.name}
        back={{ href: "/admin/customers", label: "Customers" }}
        description={`Customer since ${day(customer.joinedAt)}`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Orders">
            {customer.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {customer.orders.map((order) => (
                  <li
                    key={order.orderNumber}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>
                      {canOrders ? (
                        <Link
                          href={`/admin/orders/${order.orderNumber}` as Route}
                          className="font-medium hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                      ) : (
                        order.orderNumber
                      )}
                      <span className="ml-2 text-muted-foreground">
                        {day(order.placedAt)}
                        {order.paymentMode === "partial_cod" && " · COD"}
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
              </ul>
            )}
          </Panel>
          <Panel
            title={`Wallet · ${formatPaise(customer.wallet.balancePaise)}`}
          >
            {customer.wallet.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity.</p>
            ) : (
              <ul className="divide-y text-sm">
                {customer.wallet.entries.map((entry) => (
                  <li
                    key={`${entry.reason}-${entry.at.toISOString()}`}
                    className="flex justify-between gap-2 py-2"
                  >
                    <span>
                      {WALLET_REASON_LABEL[entry.reason] ?? entry.reason}
                      {entry.note && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {entry.note}
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {day(entry.at)}
                        {entry.expiresAt &&
                          ` · expires ${day(entry.expiresAt)}`}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {entry.amountPaise > 0 ? "+" : "−"}
                      {formatPaise(Math.abs(entry.amountPaise))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          <Panel title="Contact">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-words">
                {customer.email ?? "—"}
                {customer.email && !customer.emailVerified && " (unverified)"}
              </dd>
              <dt className="text-muted-foreground">Mobile</dt>
              <dd>
                {customer.phone ?? "—"}
                {customer.phone && !customer.phoneVerified && " (unverified)"}
              </dd>
              <dt className="text-muted-foreground">Marketing</dt>
              <dd>
                {customer.marketingEmail ? "Email consent" : "No consent"}
              </dd>
              {customer.spentPaise !== null && (
                <>
                  <dt className="text-muted-foreground">Spent</dt>
                  <dd>{formatPaise(customer.spentPaise)}</dd>
                </>
              )}
            </dl>
            {customer.deletionRequestedAt && (
              <p className="mt-2 text-sm text-destructive">
                Asked for account deletion on{" "}
                {day(customer.deletionRequestedAt)}.
              </p>
            )}
          </Panel>
          <Panel title="Cash on delivery">
            <p className="mb-2 text-sm">
              {customer.codBlocked ? (
                <>
                  <StatusBadge tone="bad">Blocked</StatusBadge>{" "}
                  {customer.codBlockedReason}
                </>
              ) : (
                "Allowed"
              )}
            </p>
            {can(actor, { customer: ["update"] }) && (
              <CodBlockForm
                userId={customer.id}
                blocked={customer.codBlocked}
              />
            )}
          </Panel>
          {can(actor, { customer: ["credit"] }) && (
            <Panel title="Goodwill credit">
              <GoodwillForm userId={customer.id} />
            </Panel>
          )}
          <Panel title="Addresses">
            <ul className="flex flex-col gap-2 text-sm">
              {customer.addresses.length === 0 && (
                <li className="text-muted-foreground">None saved.</li>
              )}
              {customer.addresses.map((a) => (
                <li key={`${a.fullName}-${a.line}`}>
                  {a.fullName}
                  {a.isDefault && (
                    <span className="text-muted-foreground"> (default)</span>
                  )}
                  <span className="block text-muted-foreground">{a.line}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-sm border bg-card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  )
}

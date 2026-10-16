import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { listCodOutstanding } from "@/features/orders"
import { can, requireStaff } from "@/features/staff"
import { formatPaise } from "@/lib/money"

import { RemittanceImport } from "./remittance-import"

export const metadata: Metadata = { title: "COD remittances" }

const day = (date: Date) =>
  date.toLocaleDateString("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  })

export default function CodPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Cod />
    </Suspense>
  )
}

async function Cod() {
  const actor = await requireStaff("/admin/orders/cod")
  if (!can(actor, { order: ["read_financials"] })) return <NoAccess />
  const data = await listCodOutstanding(actor, {})
  const canImport = can(actor, { order: ["read_financials", "update"] })

  return (
    <>
      <AdminPageHeader
        title="COD remittances"
        back={{ href: "/admin/orders", label: "Orders" }}
        description="Cash the courier collected on delivery and paid to the bank."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 self-start rounded-sm border bg-card p-4">
          <h2 className="font-semibold">
            Waiting for the courier&apos;s payment ·{" "}
            {formatPaise(data.outstandingPaise)}
          </h2>
          {data.outstanding.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing outstanding.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Order</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">AWB</th>
                    <th className="py-2 pr-3 font-medium">Delivered</th>
                    <th className="py-2 text-right font-medium">Cash due</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.outstanding.map((row) => (
                    <tr key={row.orderNumber}>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/admin/orders/${row.orderNumber}` as Route}
                          className="font-medium hover:underline"
                        >
                          {row.orderNumber}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{row.customerName}</td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {row.awb ?? "—"}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {row.deliveredAt ? day(row.deliveredAt) : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatPaise(row.codDuePaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="flex min-w-0 flex-col gap-6">
          {canImport && <RemittanceImport />}
          <section className="rounded-sm border bg-card p-4">
            <h2 className="font-semibold">Recently recorded</h2>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {data.recent.length === 0 && (
                <li className="text-muted-foreground">None yet.</li>
              )}
              {data.recent.map((row) => (
                <li
                  key={row.orderNumber}
                  className="flex justify-between gap-2"
                >
                  <span>
                    {row.orderNumber}
                    <span className="block font-mono text-xs text-muted-foreground">
                      UTR {row.utr} · {day(row.remittedAt)}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {formatPaise(row.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </>
  )
}

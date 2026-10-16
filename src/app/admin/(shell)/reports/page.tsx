import type { Metadata } from "next"
import { Suspense, type ReactNode } from "react"

import { RevenueChart } from "@/components/admin/bar-chart"
import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { codRemittanceReport, salesReport } from "@/features/reports"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"
import { dateRange, withParams } from "@/lib/admin-query"
import { formatPaise } from "@/lib/money"

export const metadata: Metadata = { title: "Reports" }

export default function ReportsPage({
  searchParams,
}: PageProps<"/admin/reports">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  )
}

async function Reports({
  searchParams,
}: Pick<PageProps<"/admin/reports">, "searchParams">) {
  const actor = await requireStaff("/admin/reports")
  if (!can(actor, { report: ["read"] })) return <NoAccess />
  const range = dateRange(await searchParams)
  let sales: Awaited<ReturnType<typeof salesReport>>
  let cod: Awaited<ReturnType<typeof codRemittanceReport>>
  try {
    ;[sales, cod] = await Promise.all([
      salesReport(actor, range),
      codRemittanceReport(actor, range),
    ])
  } catch (error) {
    if (!isDomainError(error)) throw error
    return (
      <>
        <AdminPageHeader title="Reports" />
        <RangeForm range={range} />
        <p role="alert" className="text-sm text-destructive">
          {error.message} Check the dates (at most 400 days).
        </p>
      </>
    )
  }
  const canExport = can(actor, { report: ["export"] })
  const t = sales.totals

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Sales count from the day payment was confirmed (IST). Cancelled and unpaid orders are not sales."
        actions={
          canExport && (
            <>
              <Download href={withParams("/admin/export/gst", range)}>
                GST CSV
              </Download>
              <Download href={withParams("/admin/export/sales", range)}>
                Sales CSV
              </Download>
              <Download href={withParams("/admin/export/cod", range)}>
                COD CSV
              </Download>
            </>
          )
        }
      />
      <RangeForm range={range} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Sales" value={formatPaise(t.totalPaise)} />
        <Card label="Orders" value={String(t.orders)} />
        <Card label="Units" value={String(t.units)} />
        <Card
          label="Average order"
          value={
            t.orders ? formatPaise(Math.round(t.totalPaise / t.orders)) : "—"
          }
        />
        <Card label="Discounts given" value={formatPaise(t.discountPaise)} />
        <Card label="GST included" value={formatPaise(t.taxPaise)} />
        <Card label="Shipping & COD fees" value={formatPaise(t.feesPaise)} />
        <Card label="Refunded" value={formatPaise(t.refundedPaise)} />
      </div>

      <div className="flex flex-col gap-6">
        <Panel title="Sales per day">
          {sales.byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sales in this range.
            </p>
          ) : (
            <RevenueChart
              data={sales.byDay.map((d) => ({
                day: d.day,
                revenuePaise: d.totalPaise,
                orders: d.orders,
              }))}
            />
          )}
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="By category">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 text-right font-medium">Units</th>
                  <th className="py-2 text-right font-medium">Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sales.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td className="py-1.5 pr-3">{c.category}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {c.units}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatPaise(c.revenuePaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Item sales after discounts, by each product&apos;s main category.
            </p>
          </Panel>

          <Panel title="Cash on delivery">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Remitted in this range</dt>
              <dd className="text-right tabular-nums">
                {formatPaise(cod.remittedPaise)} ({cod.remitted.length})
              </dd>
              <dt className="text-muted-foreground">
                Still to collect (all time)
              </dt>
              <dd className="text-right tabular-nums">
                {formatPaise(cod.outstandingPaise)} ({cod.outstandingOrders})
              </dd>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  )
}

function RangeForm({ range }: { range: { from: string; to: string } }) {
  const input =
    "h-9 rounded-sm border border-input bg-card px-2 text-sm text-foreground"
  return (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        From
        <input
          type="date"
          name="from"
          defaultValue={range.from}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        To
        <input
          type="date"
          name="to"
          defaultValue={range.to}
          className={input}
        />
      </label>
      <button
        type="submit"
        className="h-9 rounded-sm border border-input bg-card px-3 text-sm hover:bg-secondary"
      >
        Show
      </button>
    </form>
  )
}

function Download({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-9 items-center rounded-sm border border-input bg-card px-3 text-sm hover:bg-secondary"
    >
      {children}
    </a>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border bg-card p-4">
      <p className="text-xs text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
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

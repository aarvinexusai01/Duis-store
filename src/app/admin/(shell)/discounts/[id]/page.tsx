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
  adminGetDiscount,
  type AdminDiscountDetail,
} from "@/features/discounts"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"
import { formatPaise } from "@/lib/money"

import { CouponGenerator } from "../_components/coupon-generator"
import { DiscountForm } from "../_components/discount-form"
import { DiscountStatus } from "../_components/discount-status"
import { describeValue } from "../_components/format"
import { targetOptions } from "../_components/options"

export const metadata: Metadata = { title: "Discount" }

export default function DiscountPage({
  params,
}: PageProps<"/admin/discounts/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Discount params={params} />
    </Suspense>
  )
}

async function Discount({
  params,
}: Pick<PageProps<"/admin/discounts/[id]">, "params">) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const actor = await requireStaff(`/admin/discounts/${id}`)
  if (!can(actor, { discount: ["read"] })) return <NoAccess />
  let discount: AdminDiscountDetail
  try {
    discount = await adminGetDiscount(actor, { id })
  } catch (error) {
    if (isDomainError(error)) notFound()
    throw error
  }
  const canEdit =
    can(actor, { discount: ["update"] }) && discount.status !== "archived"
  const options = canEdit ? await targetOptions(actor) : null

  return (
    <>
      <AdminPageHeader
        title={discount.name}
        back={{ href: "/admin/discounts", label: "Discounts" }}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              tone={
                discount.status === "active"
                  ? "good"
                  : discount.status === "paused"
                    ? "warn"
                    : "neutral"
              }
            >
              {discount.status}
            </StatusBadge>
            {discount.kind === "automatic" ? "Automatic" : "Coupon"} ·{" "}
            {describeValue(discount.valueType, discount.value)}
          </span>
        }
        actions={
          <DiscountStatus
            id={discount.id}
            status={discount.status}
            canUpdate={can(actor, { discount: ["update"] })}
            canArchive={can(actor, { discount: ["archive"] })}
          />
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {options ? (
            <DiscountForm discount={discount} {...options} />
          ) : (
            <p className="rounded-sm border bg-card p-4 text-sm text-muted-foreground">
              {discount.status === "archived"
                ? "Archived discounts can't be edited."
                : "You can view this discount but not change it."}
            </p>
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          <section className="rounded-sm border bg-card p-4 text-sm">
            <h2 className="mb-2 font-semibold">Usage</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1">
              <dt className="text-muted-foreground">Orders</dt>
              <dd className="text-right tabular-nums">
                {discount.usage.orders}
              </dd>
              <dt className="text-muted-foreground">Discount given</dt>
              <dd className="text-right tabular-nums">
                {formatPaise(discount.usage.discountPaise)}
              </dd>
              <dt className="text-muted-foreground">Order revenue</dt>
              <dd className="text-right tabular-nums">
                {formatPaise(discount.usage.revenuePaise)}
              </dd>
            </dl>
            {discount.usage.recent.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 border-t pt-3">
                {discount.usage.recent.map((r) => (
                  <li key={r.orderNumber} className="flex justify-between">
                    <Link
                      href={`/admin/orders/${r.orderNumber}` as Route}
                      className="hover:underline"
                    >
                      {r.orderNumber}
                    </Link>
                    <span className="tabular-nums">
                      −{formatPaise(r.amountPaise)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {discount.kind === "coupon" && (
            <section className="rounded-sm border bg-card p-4 text-sm">
              <h2 className="mb-2 font-semibold">
                Codes ({discount.codeCount})
              </h2>
              <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                {discount.codes.map((c) => (
                  <li key={c.code} className="flex justify-between gap-2">
                    <span className="font-mono">{c.code}</span>
                    <span className="text-muted-foreground tabular-nums">
                      used {c.timesUsed}
                      {c.usageLimit !== null && ` of ${c.usageLimit}`}
                    </span>
                  </li>
                ))}
              </ul>
              {discount.codeCount > discount.codes.length && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing the first {discount.codes.length}.
                </p>
              )}
              {can(actor, { discount: ["create"] }) &&
                discount.status !== "archived" && (
                  <CouponGenerator discountId={discount.id} />
                )}
            </section>
          )}
        </aside>
      </div>
    </>
  )
}

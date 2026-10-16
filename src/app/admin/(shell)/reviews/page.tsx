import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListReviews } from "@/features/reviews"
import { can, requireStaff } from "@/features/staff"
import { choice, one, pageOf, withParams } from "@/lib/admin-query"
import { cn } from "@/lib/utils"

import { ModerateButtons } from "./moderate-buttons"

export const metadata: Metadata = { title: "Reviews" }

const TABS = [
  ["pending", "To moderate"],
  ["approved", "Published"],
  ["rejected", "Rejected"],
] as const

export default function ReviewsPage({
  searchParams,
}: PageProps<"/admin/reviews">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Reviews searchParams={searchParams} />
    </Suspense>
  )
}

async function Reviews({
  searchParams,
}: Pick<PageProps<"/admin/reviews">, "searchParams">) {
  const actor = await requireStaff("/admin/reviews")
  if (!can(actor, { review: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const status =
    choice(one(raw.status), ["pending", "approved", "rejected"] as const) ??
    "pending"
  const page = pageOf(raw)
  const list = await adminListReviews(actor, { status, page })
  const canModerate = can(actor, { review: ["moderate"] })

  return (
    <>
      <AdminPageHeader
        title="Reviews"
        description="Every review is checked before it shows. Approve honest reviews, good or bad; reject spam, abuse or personal details."
      />
      <nav aria-label="Review status" className="mb-4 flex gap-2">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            href={
              withParams("/admin/reviews", {
                status: value === "pending" ? undefined : value,
              }) as Route
            }
            aria-current={status === value ? "page" : undefined}
            className={cn(
              "rounded-sm border px-3 py-1 text-sm",
              status === value
                ? "border-ink bg-ink text-paper"
                : "bg-card hover:bg-secondary",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      {list.rows.length === 0 ? (
        <p className="rounded-sm border bg-card p-6 text-sm text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.rows.map((review) => (
            <li
              key={review.id}
              className="rounded-sm border bg-card p-4 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p>
                    <span aria-label={`${review.rating} stars`}>
                      {"★".repeat(review.rating)}
                      <span className="text-ink/20">
                        {"★".repeat(5 - review.rating)}
                      </span>
                    </span>{" "}
                    <Link
                      href={`/admin/products/${review.productId}` as Route}
                      className="font-medium hover:underline"
                    >
                      {review.productTitle}
                    </Link>
                  </p>
                  {review.title && (
                    <p className="mt-1 font-semibold">{review.title}</p>
                  )}
                  <p className="mt-1 whitespace-pre-line">{review.body}</p>
                  {review.photoIds.length > 0 && (
                    <p className="mt-2 flex gap-2">
                      {review.photoIds.map((id) => (
                        <a
                          key={id}
                          href={`/photos/${id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- private until approved */}
                          <img
                            src={`/photos/${id}`}
                            alt="Reviewer photo"
                            className="size-20 object-cover"
                          />
                        </a>
                      ))}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Shown as {review.displayName}
                    {review.customerEmail &&
                      ` · ${review.customerEmail}`} ·{" "}
                    {review.createdAt.toLocaleDateString("en-IN", {
                      dateStyle: "medium",
                      timeZone: "Asia/Kolkata",
                    })}
                    {review.moderationNote &&
                      ` · note: ${review.moderationNote}`}
                  </p>
                </div>
                {canModerate && (
                  <ModerateButtons reviewId={review.id} status={status} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.total > list.rows.length && (
        <p className="mt-4 text-sm text-muted-foreground">
          Showing {list.rows.length} of {list.total}.
        </p>
      )}
    </>
  )
}

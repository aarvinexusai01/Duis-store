import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { listScheduled } from "@/features/cms"
import { can, requireStaff } from "@/features/staff"

export const metadata: Metadata = { title: "Scheduled" }

export default function ScheduledPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Scheduled />
    </Suspense>
  )
}

async function Scheduled() {
  const actor = await requireStaff("/admin/cms/scheduled")
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  const items = await listScheduled(actor, {})
  return (
    <>
      <AdminPageHeader
        title="Scheduled"
        description="Content that goes live on its own (India time). The worker checks every minute."
      />
      {items.length === 0 ? (
        <p className="rounded-sm border bg-card p-6 text-sm text-muted-foreground">
          Nothing is scheduled.
        </p>
      ) : (
        <ul className="divide-y rounded-sm border bg-card text-sm">
          {items.map((item) => (
            <li
              key={item.revisionId}
              className="flex flex-wrap items-center gap-3 p-4"
            >
              <span className="font-medium tabular-nums">
                {item.scheduledFor.toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Kolkata",
                })}
              </span>
              <Link
                href={item.href as Route}
                className="underline underline-offset-4"
              >
                {item.label}
              </Link>
              <span className="text-muted-foreground">
                version {item.version}
              </span>
              {item.scheduledBy && (
                <span className="ml-auto text-xs text-muted-foreground">
                  by {item.scheduledBy}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminDataRequests } from "@/features/privacy/operations"
import { can, requireStaff } from "@/features/staff"

export const metadata: Metadata = { title: "Data requests" }

const day = (date: Date) =>
  date.toLocaleDateString("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  })

function Due({ at }: { at: Date }) {
  // eslint-disable-next-line react-hooks/purity -- a request-time server render
  const overdue = at.getTime() < Date.now()
  return (
    <StatusBadge tone={overdue ? "bad" : "neutral"}>
      {overdue ? "Overdue" : "Due"} {day(at)}
    </StatusBadge>
  )
}

export default function DataRequestsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Requests />
    </Suspense>
  )
}

async function Requests() {
  const actor = await requireStaff("/admin/data-requests")
  if (!can(actor, { customer: ["read"] })) return <NoAccess />
  const { deletions, messages } = await adminDataRequests(actor, {})
  const row = "flex flex-wrap items-center justify-between gap-2 py-3"
  return (
    <>
      <AdminPageHeader
        title="Data requests"
        description="Requests under the data protection law. Resolve each within a month; acknowledge messages within 48 hours."
      />
      <section className="mb-8 max-w-3xl text-sm">
        <h2 className="mb-2 font-semibold">Account deletions</h2>
        {deletions.length === 0 ? (
          <p className="text-muted-foreground">None waiting.</p>
        ) : (
          <ul className="divide-y border-y">
            {deletions.map((request) => (
              <li key={request.userId} className={row}>
                <Link
                  href={`/admin/customers/${request.userId}` as Route}
                  className="font-medium underline underline-offset-2"
                >
                  {request.name}
                </Link>
                <span className="text-muted-foreground">
                  Asked {day(request.requestedAt)}
                </span>
                <Due at={request.dueAt} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="max-w-3xl text-sm">
        <h2 className="mb-2 font-semibold">Privacy messages</h2>
        {messages.length === 0 ? (
          <p className="text-muted-foreground">None open.</p>
        ) : (
          <ul className="divide-y border-y">
            {messages.map((message) => (
              <li key={message.id} className={row}>
                <Link
                  href={`/admin/messages/${message.id}` as Route}
                  className="font-medium underline underline-offset-2"
                >
                  {message.name}
                </Link>
                <span className="text-muted-foreground">
                  Received {day(message.receivedAt)}
                </span>
                <Due at={message.dueAt} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

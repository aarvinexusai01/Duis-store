import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListMessages, CONTACT_TOPICS } from "@/features/contact"
import { can, requireStaff } from "@/features/staff"
import { choice, one, pageOf, withParams } from "@/lib/admin-query"
import { cn } from "@/lib/utils"

import { MESSAGE_STATUS_LABEL, MESSAGE_STATUS_TONE } from "./status"

export const metadata: Metadata = { title: "Messages" }

const TABS = [
  ["new", "New"],
  ["replied", "Replied"],
  ["closed", "Closed"],
  ["all", "All"],
] as const

export default function MessagesPage({
  searchParams,
}: PageProps<"/admin/messages">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Messages searchParams={searchParams} />
    </Suspense>
  )
}

async function Messages({
  searchParams,
}: Pick<PageProps<"/admin/messages">, "searchParams">) {
  const actor = await requireStaff("/admin/messages")
  if (!can(actor, { customer: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const status =
    choice(one(raw.status), ["new", "replied", "closed", "all"] as const) ??
    "new"
  const q = one(raw.q)
  const page = pageOf(raw)
  const list = await adminListMessages(actor, { status, q, page })

  return (
    <>
      <AdminPageHeader
        title="Messages"
        description="From the contact form. Reply by email, then mark the message replied."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Message status" className="flex gap-2">
          {TABS.map(([value, label]) => (
            <Link
              key={value}
              href={
                withParams("/admin/messages", {
                  status: value === "new" ? undefined : value,
                  q,
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
        <form role="search" className="flex gap-2">
          {status !== "new" && (
            <input type="hidden" name="status" value={status} />
          )}
          <label htmlFor="messages-q" className="sr-only">
            Search messages
          </label>
          <input
            id="messages-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, email or order"
            className="h-9 w-56 rounded-sm border bg-card px-3 text-sm"
          />
        </form>
      </div>
      {list.rows.length === 0 ? (
        <p className="rounded-sm border bg-card p-6 text-sm text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <ul className="divide-y rounded-sm border bg-card">
          {list.rows.map((message) => (
            <li key={message.id}>
              <Link
                href={`/admin/messages/${message.id}` as Route}
                className="flex flex-col gap-1 p-4 text-sm hover:bg-secondary"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={MESSAGE_STATUS_TONE[message.status]}>
                    {MESSAGE_STATUS_LABEL[message.status]}
                  </StatusBadge>
                  <span className="font-medium">{message.name}</span>
                  <span className="text-muted-foreground">{message.email}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {message.createdAt.toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Kolkata",
                    })}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {CONTACT_TOPICS[message.topic]}
                  {message.orderNumber && ` · ${message.orderNumber}`}
                </span>
                <span className="line-clamp-2">{message.message}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.total > list.rows.length && (
        <p className="mt-4 text-sm text-muted-foreground">
          Showing {list.rows.length} of {list.total}.{" "}
          {list.total > page * list.rows.length && (
            <Link
              href={
                withParams("/admin/messages", {
                  status: status === "new" ? undefined : status,
                  q,
                  page: page + 1,
                }) as Route
              }
              className="underline underline-offset-4"
            >
              Next page
            </Link>
          )}
        </p>
      )}
    </>
  )
}

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
import { adminGetMessage, CONTACT_TOPICS } from "@/features/contact"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"

import { MESSAGE_STATUS_LABEL, MESSAGE_STATUS_TONE } from "../status"
import { MessageDesk } from "./message-desk"

export const metadata: Metadata = { title: "Message" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function MessagePage({
  params,
}: PageProps<"/admin/messages/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Message params={params} />
    </Suspense>
  )
}

async function Message({
  params,
}: Pick<PageProps<"/admin/messages/[id]">, "params">) {
  const { id } = await params
  const actor = await requireStaff(`/admin/messages/${id}`)
  if (!can(actor, { customer: ["read"] })) return <NoAccess />
  if (!UUID.test(id)) notFound()
  const message = await adminGetMessage(actor, { id }).catch((error) => {
    if (isDomainError(error)) notFound()
    throw error
  })
  const subject = `Re: your message to Duis${message.orderNumber ? ` (${message.orderNumber})` : ""}`
  const replyHref = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(subject)}`
  const date = (value: Date) =>
    value.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    })

  return (
    <>
      <AdminPageHeader
        title={message.name}
        back={{ href: "/admin/messages", label: "Messages" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={MESSAGE_STATUS_TONE[message.status]}>
              {MESSAGE_STATUS_LABEL[message.status]}
            </StatusBadge>
            {CONTACT_TOPICS[message.topic]} · {date(message.createdAt)}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-sm border bg-card p-4 text-sm">
          <p className="whitespace-pre-line">{message.message}</p>
        </section>
        <aside className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-sm border bg-card p-4 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all">{message.email}</dd>
            {message.phone && (
              <>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{message.phone}</dd>
              </>
            )}
            {message.orderNumber && (
              <>
                <dt className="text-muted-foreground">Order</dt>
                <dd>
                  {message.orderExists && can(actor, { order: ["read"] }) ? (
                    <Link
                      href={`/admin/orders/${message.orderNumber}` as Route}
                      className="underline underline-offset-4"
                    >
                      {message.orderNumber}
                    </Link>
                  ) : (
                    <>
                      {message.orderNumber}
                      {!message.orderExists && " (no such order)"}
                    </>
                  )}
                </dd>
              </>
            )}
            {message.otherMessages > 0 && (
              <>
                <dt className="text-muted-foreground">Earlier</dt>
                <dd>
                  <Link
                    href={
                      `/admin/messages?status=all&q=${encodeURIComponent(message.email)}` as Route
                    }
                    className="underline underline-offset-4"
                  >
                    {message.otherMessages} other message
                    {message.otherMessages === 1 ? "" : "s"}
                  </Link>
                </dd>
              </>
            )}
            {message.handledBy && message.handledAt && (
              <>
                <dt className="text-muted-foreground">Handled</dt>
                <dd>
                  {message.handledBy}, {date(message.handledAt)}
                </dd>
              </>
            )}
          </dl>
          <a
            href={replyHref}
            className="inline-flex h-10 items-center justify-center rounded-sm border bg-card px-4 text-sm font-medium hover:bg-secondary"
          >
            Reply by email
          </a>
          {can(actor, { customer: ["update"] }) && (
            <MessageDesk
              id={message.id}
              status={message.status}
              note={message.note}
            />
          )}
          {!can(actor, { customer: ["update"] }) && message.note && (
            <p className="rounded-sm border bg-card p-4 text-sm">
              <span className="font-medium">Note:</span> {message.note}
            </p>
          )}
        </aside>
      </div>
    </>
  )
}

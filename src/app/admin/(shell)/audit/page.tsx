import type { Metadata } from "next"
import { Suspense } from "react"

import { DataTable, type Column } from "@/components/admin/data-table"
import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { can, requireStaff } from "@/features/staff"
import {
  AUDIT_PAGE_SIZE,
  listAuditLogs,
  type AuditRow,
} from "@/features/system"
import { one, pageOf } from "@/lib/admin-query"

export const metadata: Metadata = { title: "Audit log" }

const DATE = /^\d{4}-\d{2}-\d{2}$/

export default function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  )
}

async function Audit({
  searchParams,
}: Pick<PageProps<"/admin/audit">, "searchParams">) {
  const actor = await requireStaff("/admin/audit")
  if (!can(actor, { audit: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const from = one(raw.from)
  const to = one(raw.to)
  const params = {
    q: one(raw.q),
    action: one(raw.action),
    entityType: one(raw.entityType),
    entityId: one(raw.entityId),
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
  }
  const page = pageOf(raw)
  const list = await listAuditLogs(actor, {
    actor: params.q,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    from: params.from,
    to: params.to,
    page,
  })

  const columns: Column<AuditRow>[] = [
    {
      key: "at",
      header: "When",
      className: "whitespace-nowrap text-muted-foreground align-top",
      cell: (row) =>
        row.at.toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "medium",
          timeZone: "Asia/Kolkata",
        }),
    },
    {
      key: "actor",
      header: "Who",
      className: "align-top",
      cell: (row) => (
        <span>
          {row.actor}
          {row.roles.length > 0 && (
            <span className="block text-xs text-muted-foreground">
              {row.roles.join(", ").replace(/_/g, " ")}
              {row.ip && ` · ${row.ip}`}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      className: "align-top",
      cell: (row) => <span className="font-mono text-xs">{row.action}</span>,
    },
    {
      key: "entity",
      header: "Record",
      className: "align-top",
      cell: (row) => (
        <span className="text-xs">
          {row.entityType}
          {row.entityId && (
            <span className="block font-mono break-all text-muted-foreground">
              {row.entityId}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "changes",
      header: "Details",
      className: "align-top",
      cell: (row) =>
        row.changes ? (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Show
            </summary>
            <pre className="mt-1 max-w-md overflow-x-auto rounded-sm bg-secondary p-2 text-xs whitespace-pre-wrap">
              {JSON.stringify(row.changes, null, 2)}
            </pre>
          </details>
        ) : null,
    },
  ]

  const input =
    "h-9 rounded-sm border border-input bg-card px-2 text-sm text-foreground"
  return (
    <>
      <AdminPageHeader
        title="Audit log"
        description="Every staff change and system action, newest first. Entries can't be edited or deleted."
      />
      <DataTable
        id="audit"
        rows={list.rows}
        columns={columns}
        rowKey={(row) => row.id}
        total={list.total}
        page={page}
        pageSize={AUDIT_PAGE_SIZE}
        basePath="/admin/audit"
        params={params}
        search={{ placeholder: "Person (name or email)" }}
        filters={[
          {
            name: "entityType",
            label: "Record type",
            options: list.entityTypes.map((t) => ({ value: t, label: t })),
          },
        ]}
        fields={
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Action contains
              <input
                name="action"
                defaultValue={params.action}
                placeholder="e.g. refund"
                className={`${input} w-36`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Record id
              <input
                name="entityId"
                defaultValue={params.entityId}
                className={`${input} w-40`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input
                type="date"
                name="from"
                defaultValue={params.from}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input
                type="date"
                name="to"
                defaultValue={params.to}
                className={input}
              />
            </label>
          </>
        }
        empty="No entries match."
      />
    </>
  )
}

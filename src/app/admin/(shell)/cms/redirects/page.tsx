import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListRedirects, REDIRECTS_PAGE_SIZE } from "@/features/redirects"
import { can, requireStaff } from "@/features/staff"
import { one, pageOf, withParams } from "@/lib/admin-query"

import { DeleteRedirectButton, NewRedirectForm } from "./redirect-forms"

export const metadata: Metadata = { title: "Redirects" }

export default function RedirectsPage({
  searchParams,
}: PageProps<"/admin/cms/redirects">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Redirects searchParams={searchParams} />
    </Suspense>
  )
}

async function Redirects({
  searchParams,
}: Pick<PageProps<"/admin/cms/redirects">, "searchParams">) {
  const actor = await requireStaff("/admin/cms/redirects")
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const q = one(raw.q)
  const page = pageOf(raw)
  const { rows, total } = await adminListRedirects(actor, { q, page })
  const canEdit = can(actor, { cms: ["publish"] })

  return (
    <>
      <AdminPageHeader
        title="Redirects"
        description="Old addresses that send visitors somewhere else. Changing a page, product, collection or category address adds one automatically. Changes reach the site within 30 seconds."
      />
      {canEdit && <NewRedirectForm />}
      <form role="search" className="my-4 flex gap-2">
        <label htmlFor="redirects-q" className="sr-only">
          Search redirects
        </label>
        <input
          id="redirects-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search addresses"
          className="h-9 w-64 rounded-sm border bg-card px-3 text-sm"
        />
      </form>
      {rows.length === 0 ? (
        <p className="rounded-sm border bg-card p-6 text-sm text-muted-foreground">
          No redirects yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-sm border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="p-3 font-medium">From</th>
                <th className="p-3 font-medium">To</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 text-right font-medium">Visits</th>
                <th className="p-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="p-3 font-mono text-xs break-all">
                    {row.fromPath}
                  </td>
                  <td className="p-3 font-mono text-xs break-all">
                    {row.toPath}
                  </td>
                  <td className="p-3">
                    <span className="flex flex-wrap gap-1">
                      <StatusBadge
                        tone={row.statusCode === 301 ? "good" : "info"}
                      >
                        {row.statusCode === 301 ? "Permanent" : "Temporary"}
                      </StatusBadge>
                      {row.source === "auto" && (
                        <StatusBadge tone="neutral">Automatic</StatusBadge>
                      )}
                    </span>
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {row.hits}
                    {row.lastHitAt && (
                      <span className="block text-xs text-muted-foreground">
                        last{" "}
                        {row.lastHitAt.toLocaleDateString("en-IN", {
                          dateStyle: "medium",
                          timeZone: "Asia/Kolkata",
                        })}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {canEdit && (
                      <DeleteRedirectButton id={row.id} from={row.fromPath} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 flex gap-3 text-sm text-muted-foreground">
        {total} redirect{total === 1 ? "" : "s"}
        {page > 1 && (
          <Link
            href={
              withParams("/admin/cms/redirects", { q, page: page - 1 }) as Route
            }
            className="underline"
          >
            Previous
          </Link>
        )}
        {page * REDIRECTS_PAGE_SIZE < total && (
          <Link
            href={
              withParams("/admin/cms/redirects", { q, page: page + 1 }) as Route
            }
            className="underline"
          >
            Next
          </Link>
        )}
      </p>
    </>
  )
}

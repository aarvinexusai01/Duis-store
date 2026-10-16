import type { Route } from "next"
import Link from "next/link"
import type { ReactNode } from "react"

import { withParams } from "@/lib/admin-query"
import { cn } from "@/lib/utils"

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

export type TableFilter = {
  name: string
  label: string
  options: { value: string; label: string }[]
}

type BulkAction = {
  action: (form: FormData) => Promise<void>
  buttons: { value: string; label: string; destructive?: boolean }[]
}

/**
 * Server-rendered admin table (doc/06 Phase 4 §1): search, filters and
 * pagination are a GET form and links; bulk actions post the checked row
 * ids to a Server Action. No client state, so it works without JavaScript.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  total,
  page,
  pageSize,
  basePath,
  params,
  search,
  filters = [],
  bulk,
  empty = "Nothing here yet.",
  toolbar,
  fields,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  total: number
  page: number
  pageSize: number
  basePath: string
  /** Current URL parameters other than page (kept on pagination links). */
  params: Record<string, string | undefined>
  search?: { placeholder: string }
  filters?: TableFilter[]
  bulk?: BulkAction
  empty?: string
  toolbar?: ReactNode
  /** More inputs for the filter form (e.g. a date range). */
  fields?: ReactNode
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  const table = (
    <div className="overflow-x-auto rounded-sm border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-secondary/50 text-left text-xs text-muted-foreground uppercase">
          <tr>
            {bulk && (
              <th className="w-10 px-3 py-2">
                <span className="sr-only">Select</span>
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-3 py-2 font-medium whitespace-nowrap",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (bulk ? 1 : 0)}
                className="px-3 py-10 text-center text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-secondary/30">
                {bulk && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      name="ids"
                      value={rowKey(row)}
                      aria-label="Select row"
                      className="accent-ink"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn("px-3 py-2 align-middle", column.className)}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {(search || filters.length > 0 || toolbar || fields) && (
        <div className="flex flex-wrap items-end gap-2">
          <form
            method="get"
            action={basePath}
            className="flex flex-wrap items-end gap-2"
          >
            {search && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Search
                <input
                  type="search"
                  name="q"
                  defaultValue={params.q ?? ""}
                  placeholder={search.placeholder}
                  className="h-9 w-64 rounded-sm border border-input bg-card px-2 text-sm text-foreground"
                />
              </label>
            )}
            {filters.map((filter) => (
              <label
                key={filter.name}
                className="flex flex-col gap-1 text-xs text-muted-foreground"
              >
                {filter.label}
                <select
                  name={filter.name}
                  defaultValue={params[filter.name] ?? ""}
                  className="h-9 rounded-sm border border-input bg-card px-2 text-sm text-foreground"
                >
                  <option value="">All</option>
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {fields}
            <button
              type="submit"
              className="h-9 rounded-sm border border-input bg-card px-3 text-sm hover:bg-secondary"
            >
              Apply
            </button>
          </form>
          {toolbar && <div className="ml-auto flex gap-2">{toolbar}</div>}
        </div>
      )}

      {bulk ? (
        <form action={bulk.action} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">With selected:</span>
            {bulk.buttons.map((button) => (
              <button
                key={button.value}
                type="submit"
                name="intent"
                value={button.value}
                className={cn(
                  "h-8 rounded-sm border px-3 hover:bg-secondary",
                  button.destructive &&
                    "border-destructive/40 text-destructive",
                )}
              >
                {button.label}
              </button>
            ))}
          </div>
          {table}
        </form>
      ) : (
        table
      )}

      <nav
        aria-label="Pagination"
        className="flex items-center justify-between text-sm text-muted-foreground"
      >
        <span>
          {from}–{to} of {total}
        </span>
        <span className="flex gap-2">
          {page > 1 && (
            <Link
              href={
                withParams(basePath, { ...params, page: page - 1 }) as Route
              }
              className="rounded-sm border px-3 py-1 hover:bg-secondary"
            >
              Previous
            </Link>
          )}
          {page < pages && (
            <Link
              href={
                withParams(basePath, { ...params, page: page + 1 }) as Route
              }
              className="rounded-sm border px-3 py-1 hover:bg-secondary"
            >
              Next
            </Link>
          )}
        </span>
      </nav>
    </div>
  )
}

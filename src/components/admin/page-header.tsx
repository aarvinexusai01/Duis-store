import type { Route } from "next"
import Link from "next/link"
import type { ReactNode } from "react"

export function AdminPageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: string
  description?: ReactNode
  back?: { href: string; label: string }
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href as Route}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {back.label}
          </Link>
        )}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function NoAccess() {
  return (
    <div role="alert" className="rounded-sm border bg-card p-6 text-sm">
      <p className="font-semibold">You don&apos;t have access to this page.</p>
      <p className="mt-1 text-muted-foreground">
        Ask a super admin if you need it for your work.
      </p>
    </div>
  )
}

const TONE = {
  neutral: "bg-secondary text-foreground",
  good: "bg-emerald-100 text-emerald-900",
  warn: "bg-amber-100 text-amber-900",
  bad: "bg-red-100 text-red-900",
  info: "bg-sky-100 text-sky-900",
} as const

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONE
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[tone]}`}
    >
      {children}
    </span>
  )
}

import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListPages, pageHref } from "@/features/cms"
import { can, requireStaff } from "@/features/staff"
import { choice, one } from "@/lib/admin-query"
import { cn } from "@/lib/utils"

import { NewPageForm } from "./_components/new-page-form"

export const metadata: Metadata = { title: "Pages" }

const TYPE_LABEL = {
  home: "Home",
  landing: "Landing",
  static: "Page",
  policy: "Policy",
} as const

export default function CmsPagesPage({
  searchParams,
}: PageProps<"/admin/cms">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Pages searchParams={searchParams} />
    </Suspense>
  )
}

async function Pages({
  searchParams,
}: Pick<PageProps<"/admin/cms">, "searchParams">) {
  const actor = await requireStaff("/admin/cms")
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  const view =
    choice(one((await searchParams).view), ["review", "scheduled"] as const) ??
    "all"
  const { rows, counts } = await adminListPages(actor, { view })
  const tabs = [
    ["all", "All pages", null],
    ["review", "Needs review", counts.review],
    ["scheduled", "Scheduled", counts.scheduled],
  ] as const

  return (
    <>
      <AdminPageHeader
        title="Pages"
        description="The home page, landing pages and information pages. Changes save as drafts until published."
        actions={can(actor, { cms: ["draft"] }) ? <NewPageForm /> : undefined}
      />
      <nav aria-label="Page views" className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([value, label, count]) => (
          <Link
            key={value}
            href={
              (value === "all"
                ? "/admin/cms"
                : `/admin/cms?view=${value}`) as Route
            }
            aria-current={view === value ? "page" : undefined}
            className={cn(
              "rounded-sm border px-3 py-1 text-sm",
              view === value
                ? "border-ink bg-ink text-paper"
                : "bg-card hover:bg-secondary",
            )}
          >
            {label}
            {count ? ` (${count})` : ""}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="rounded-sm border bg-card p-6 text-sm text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <ul className="divide-y rounded-sm border bg-card">
          {rows.map((page) => (
            <li key={page.id}>
              <Link
                href={`/admin/cms/pages/${page.id}` as Route}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm hover:bg-secondary"
              >
                <span className="font-medium">{page.title}</span>
                <span className="text-muted-foreground">
                  {page.type === "home" ? "/" : pageHref(page.slug)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {TYPE_LABEL[page.type]}
                </span>
                <span className="ml-auto flex flex-wrap gap-2">
                  <StatusBadge
                    tone={
                      page.status === "published"
                        ? "good"
                        : page.status === "archived"
                          ? "neutral"
                          : "warn"
                    }
                  >
                    {page.status === "published"
                      ? "Live"
                      : page.status === "archived"
                        ? "Archived"
                        : "Not live"}
                  </StatusBadge>
                  {page.draftStatus === "in_review" && (
                    <StatusBadge tone="info">Needs review</StatusBadge>
                  )}
                  {page.draftStatus === "scheduled" && page.scheduledFor && (
                    <StatusBadge tone="info">
                      Scheduled{" "}
                      {page.scheduledFor.toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Kolkata",
                      })}
                    </StatusBadge>
                  )}
                  {page.draftStatus === "draft" && page.unpublishedChanges && (
                    <StatusBadge tone="warn">Unpublished changes</StatusBadge>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

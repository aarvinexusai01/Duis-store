import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListPosts, getJournalTaxonomy } from "@/features/cms"
import { can, requireStaff } from "@/features/staff"
import { choice, one } from "@/lib/admin-query"
import { cn } from "@/lib/utils"

import { NewPostForm } from "./new-post-form"

export const metadata: Metadata = { title: "Journal" }

const ist = (date: Date) =>
  date.toLocaleDateString("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  })

export default function JournalAdminPage({
  searchParams,
}: PageProps<"/admin/cms/journal">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Posts searchParams={searchParams} />
    </Suspense>
  )
}

async function Posts({
  searchParams,
}: Pick<PageProps<"/admin/cms/journal">, "searchParams">) {
  const actor = await requireStaff("/admin/cms/journal")
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  const view =
    choice(one((await searchParams).view), ["review", "scheduled"] as const) ??
    "all"
  const [posts, taxonomy] = await Promise.all([
    adminListPosts(actor, { view }),
    getJournalTaxonomy(actor, {}),
  ])
  const tabs = [
    ["all", "All stories"],
    ["review", "Needs review"],
    ["scheduled", "Scheduled"],
  ] as const

  return (
    <>
      <AdminPageHeader
        title="Journal"
        description="Stories at /journal. They follow the same review and publishing steps as pages."
        actions={
          <span className="flex gap-2">
            <Link
              href="/admin/cms/journal/settings"
              className="inline-flex h-9 items-center rounded-sm border bg-card px-3 text-sm hover:bg-secondary"
            >
              Authors, categories and tags
            </Link>
            {can(actor, { cms: ["draft"] }) && (
              <NewPostForm
                authors={taxonomy.authors.map((a) => ({
                  id: a.id,
                  label: a.name,
                }))}
              />
            )}
          </span>
        }
      />
      <nav aria-label="Story views" className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([value, label]) => (
          <Link
            key={value}
            href={
              (value === "all"
                ? "/admin/cms/journal"
                : `/admin/cms/journal?view=${value}`) as Route
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
          </Link>
        ))}
      </nav>
      {posts.length === 0 ? (
        <p className="rounded-sm border bg-card p-6 text-sm text-muted-foreground">
          {taxonomy.authors.length === 0
            ? "Add an author under “Authors, categories and tags” first, then write the first story."
            : "No stories here yet."}
        </p>
      ) : (
        <ul className="divide-y rounded-sm border bg-card">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/admin/cms/journal/${post.id}` as Route}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm hover:bg-secondary"
              >
                <span className="font-medium">{post.title}</span>
                <span className="text-muted-foreground">
                  /journal/{post.slug}
                </span>
                {post.author && (
                  <span className="text-xs text-muted-foreground">
                    by {post.author}
                  </span>
                )}
                <span className="ml-auto flex flex-wrap gap-2">
                  <StatusBadge
                    tone={
                      post.status === "published"
                        ? "good"
                        : post.status === "archived"
                          ? "neutral"
                          : "warn"
                    }
                  >
                    {post.status === "published" && post.publishedAt
                      ? `Live since ${ist(post.publishedAt)}`
                      : post.status === "archived"
                        ? "Archived"
                        : "Not live"}
                  </StatusBadge>
                  {post.draftStatus === "in_review" && (
                    <StatusBadge tone="info">Needs review</StatusBadge>
                  )}
                  {post.draftStatus === "scheduled" && post.scheduledFor && (
                    <StatusBadge tone="info">
                      Scheduled {ist(post.scheduledFor)}
                    </StatusBadge>
                  )}
                  {post.draftStatus === "draft" && post.unpublishedChanges && (
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

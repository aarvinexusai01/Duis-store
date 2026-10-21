import type { Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { Breadcrumbs } from "@/components/breadcrumbs"
import { MediaImage } from "@/components/media-image"
import { cn } from "@/lib/utils"

import { JOURNAL_PAGE_SIZE, type JournalFilter } from "@/features/cms/journal"
import {
  getJournalCategories,
  getJournalList,
  getJournalTerm,
} from "@/features/cms/queries"
import { PostCard } from "./post-card"

const TERM_LABEL = {
  category: "Category",
  tag: "Tag",
  author: "Writer",
} as const

/**
 * The Journal's listing (doc/06 Phase 6c): every post, or those in a
 * category, with a tag or by an author. Call after a request-time API.
 */
export async function JournalListing({
  filter,
  page,
  basePath,
}: {
  filter: JournalFilter
  page: number
  basePath: string
}) {
  const term =
    filter.kind === "all"
      ? null
      : await getJournalTerm(filter.kind, filter.slug)
  if (filter.kind !== "all" && !term) notFound()
  const [{ posts, total }, categories] = await Promise.all([
    getJournalList(filter, page),
    getJournalCategories(),
  ])
  if (page > 1 && posts.length === 0) notFound()
  const lead = filter.kind === "all" && page === 1 ? posts[0] : undefined
  const rest = lead ? posts.slice(1) : posts
  const pageHref = (n: number) =>
    (n === 1 ? basePath : `${basePath}?page=${n}`) as Route

  return (
    <div className="page-container py-6">
      <Breadcrumbs
        items={[
          { label: "Journal", href: "/journal" },
          ...(term ? [{ label: term.name, href: basePath }] : []),
        ]}
      />
      <header className="mt-6 flex flex-wrap items-end gap-6">
        {term?.photo && (
          <span className="relative block size-20 overflow-hidden rounded-full bg-secondary">
            <MediaImage
              media={term.photo}
              alt=""
              fill
              sizes="80px"
              className="object-cover"
            />
          </span>
        )}
        <div className="max-w-2xl">
          {term && (
            <p className="text-xs font-semibold tracking-wider text-rust uppercase">
              {TERM_LABEL[term.kind]}
            </p>
          )}
          <h1 className="display-heading text-5xl sm:text-6xl">
            {term?.name ?? "The Journal"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {term?.description ??
              (term
                ? null
                : "Stories, styling notes and the people behind the drops.")}
          </p>
        </div>
      </header>
      {categories.length > 0 && (
        <nav
          aria-label="Journal categories"
          className="mt-6 flex flex-wrap gap-2"
        >
          <Link
            href="/journal"
            aria-current={filter.kind === "all" ? "page" : undefined}
            className={cn(
              "border px-3 py-1 text-sm",
              filter.kind === "all"
                ? "border-ink bg-ink text-paper"
                : "hover:bg-secondary",
            )}
          >
            All
          </Link>
          {categories.map((category) => {
            const active =
              filter.kind === "category" && filter.slug === category.slug
            return (
              <Link
                key={category.slug}
                href={`/journal/category/${category.slug}` as Route}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "border px-3 py-1 text-sm",
                  active
                    ? "border-ink bg-ink text-paper"
                    : "hover:bg-secondary",
                )}
              >
                {category.name}
              </Link>
            )
          })}
        </nav>
      )}
      {posts.length === 0 ? (
        <p className="mt-10 border border-dashed p-10 text-center text-muted-foreground">
          Nothing here yet. New stories are on their way.
        </p>
      ) : (
        <>
          {lead && (
            <div className="mt-10">
              <PostCard post={lead} large preload />
            </div>
          )}
          <ul className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((post, index) => (
              <li key={post.id}>
                <PostCard post={post} preload={!lead && index < 3} />
              </li>
            ))}
          </ul>
        </>
      )}
      {total > JOURNAL_PAGE_SIZE && (
        <nav
          aria-label="Pages"
          className="mt-10 flex justify-center gap-4 text-sm"
        >
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="underline">
              Newer stories
            </Link>
          )}
          {page * JOURNAL_PAGE_SIZE < total && (
            <Link href={pageHref(page + 1)} className="underline">
              Older stories
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}

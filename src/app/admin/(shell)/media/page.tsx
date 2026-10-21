import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListMedia, MEDIA_PAGE_SIZE } from "@/features/media"
import { can, requireStaff } from "@/features/staff"
import { choice, one, pageOf, withParams } from "@/lib/admin-query"
import { cn } from "@/lib/utils"

import { MediaLibrary } from "./media-library"
import { UploadButton } from "./upload-button"

export const metadata: Metadata = { title: "Media" }

export default function MediaPage({ searchParams }: PageProps<"/admin/media">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Media searchParams={searchParams} />
    </Suspense>
  )
}

async function Media({
  searchParams,
}: Pick<PageProps<"/admin/media">, "searchParams">) {
  const actor = await requireStaff("/admin/media")
  if (!can(actor, { media: ["read"] })) return <NoAccess />
  const raw = await searchParams
  const q = one(raw.q)
  const filter = choice(one(raw.filter), ["unused"] as const) ?? "all"
  const view = choice(one(raw.view), ["list"] as const) ?? "grid"
  const page = pageOf(raw)
  const { items, total } = await adminListMedia(actor, { q, filter, page })
  const href = (patch: Record<string, string | number | undefined>) =>
    withParams("/admin/media", {
      q,
      filter: filter === "all" ? undefined : filter,
      view: view === "grid" ? undefined : view,
      ...patch,
    }) as Route
  const tab = (active: boolean) =>
    cn(
      "rounded-sm border px-3 py-1 text-sm",
      active ? "border-ink bg-ink text-paper" : "bg-card hover:bg-secondary",
    )

  return (
    <>
      <AdminPageHeader
        title="Media"
        description="Every uploaded image. An image in use can't be deleted until it's removed from where it's used."
        actions={
          can(actor, { media: ["upload"] }) ? <UploadButton /> : undefined
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Filter" className="flex gap-2">
          <Link
            href={href({ filter: undefined, page: undefined })}
            aria-current={filter === "all" ? "page" : undefined}
            className={tab(filter === "all")}
          >
            All
          </Link>
          <Link
            href={href({ filter: "unused", page: undefined })}
            aria-current={filter === "unused" ? "page" : undefined}
            className={tab(filter === "unused")}
          >
            Unused
          </Link>
        </nav>
        <nav aria-label="Layout" className="flex gap-2">
          <Link
            href={href({ view: undefined })}
            aria-current={view === "grid" ? "page" : undefined}
            className={tab(view === "grid")}
          >
            Grid
          </Link>
          <Link
            href={href({ view: "list" })}
            aria-current={view === "list" ? "page" : undefined}
            className={tab(view === "list")}
          >
            List
          </Link>
        </nav>
        <form role="search" className="ml-auto flex gap-2">
          {filter !== "all" && (
            <input type="hidden" name="filter" value={filter} />
          )}
          {view !== "grid" && <input type="hidden" name="view" value={view} />}
          <label htmlFor="media-q" className="sr-only">
            Search images
          </label>
          <input
            id="media-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Alt text or file name"
            className="h-9 w-56 rounded-sm border bg-card px-3 text-sm"
          />
        </form>
      </div>
      <MediaLibrary
        items={items}
        view={view}
        canEdit={can(actor, { media: ["update"] })}
        canDelete={can(actor, { media: ["delete"] })}
      />
      <p className="mt-4 flex gap-3 text-sm text-muted-foreground">
        {total} image{total === 1 ? "" : "s"}
        {page > 1 && (
          <Link href={href({ page: page - 1 })} className="underline">
            Previous
          </Link>
        )}
        {page * MEDIA_PAGE_SIZE < total && (
          <Link href={href({ page: page + 1 })} className="underline">
            Next
          </Link>
        )}
      </p>
    </>
  )
}

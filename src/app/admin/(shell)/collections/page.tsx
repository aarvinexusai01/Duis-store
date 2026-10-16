import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { MediaThumb } from "@/components/media-thumb"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListCollections } from "@/features/collections"
import { can, requireStaff } from "@/features/staff"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Collections" }

const TONE = { draft: "neutral", published: "good", archived: "bad" } as const

export default function CollectionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Collections />
    </Suspense>
  )
}

async function Collections() {
  const actor = await requireStaff("/admin/collections")
  if (!can(actor, { collection: ["read"] })) return <NoAccess />
  const rows = await adminListCollections(actor, {})
  return (
    <>
      <AdminPageHeader
        title="Collections"
        description="Hand-picked edits and automatic, rule-based sets."
        actions={
          can(actor, { collection: ["create"] }) && (
            <Link
              href="/admin/collections/new"
              className={cn(buttonVariants(), "rounded-sm")}
            >
              New collection
            </Link>
          )
        }
      />
      <ul className="divide-y rounded-sm border bg-card">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/admin/collections/${row.id}` as Route}
              className="flex items-center gap-3 px-4 py-2 hover:bg-secondary/40"
            >
              <MediaThumb mediaKey={row.imageKey} size={36} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{row.title}</span>
                <span className="block text-xs text-muted-foreground">
                  /{row.slug} ·{" "}
                  {row.type === "automatic" ? "automatic" : "hand-picked"} ·{" "}
                  {row.productCount} products
                </span>
              </span>
              <StatusBadge tone={TONE[row.status]}>{row.status}</StatusBadge>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            No collections yet.
          </li>
        )}
      </ul>
    </>
  )
}

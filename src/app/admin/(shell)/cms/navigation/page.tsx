import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { getEditor } from "@/features/cms"
import { can, requireStaff } from "@/features/staff"

export const metadata: Metadata = { title: "Menus" }

const MENUS = [
  {
    key: "header",
    name: "Header menu",
    about: "The main menu and mega menu, and the mobile menu.",
  },
  {
    key: "footer",
    name: "Footer menu",
    about: "Columns of links at the bottom of every page.",
  },
] as const

export default function MenusPage() {
  return (
    <Suspense fallback={<Skeleton className="h-48 w-full" />}>
      <Menus />
    </Suspense>
  )
}

async function Menus() {
  const actor = await requireStaff("/admin/cms/navigation")
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  const states = await Promise.all(
    MENUS.map((menu) =>
      getEditor(actor, { target: { type: "navigation", key: menu.key } }),
    ),
  )
  return (
    <>
      <AdminPageHeader
        title="Menus"
        description="Changes save as drafts and go live when published."
      />
      <ul className="divide-y rounded-sm border bg-card">
        {MENUS.map((menu, i) => {
          const draft = states[i]!.draft
          const pending =
            draft && ["draft", "in_review", "scheduled"].includes(draft.status)
          return (
            <li key={menu.key}>
              <Link
                href={`/admin/cms/navigation/${menu.key}` as Route}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm hover:bg-secondary"
              >
                <span className="font-medium">{menu.name}</span>
                <span className="text-muted-foreground">{menu.about}</span>
                {pending && (
                  <StatusBadge
                    tone={draft.status === "in_review" ? "info" : "warn"}
                  >
                    {draft.status === "in_review"
                      ? "Needs review"
                      : draft.status === "scheduled"
                        ? "Scheduled"
                        : "Unpublished changes"}
                  </StatusBadge>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}

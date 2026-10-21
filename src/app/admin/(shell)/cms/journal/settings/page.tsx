import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { getJournalTaxonomy } from "@/features/cms"
import { can, requireStaff } from "@/features/staff"

import { JournalTerms } from "./journal-terms"

export const metadata: Metadata = { title: "Journal settings" }

export default function JournalSettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Settings />
    </Suspense>
  )
}

async function Settings() {
  const actor = await requireStaff("/admin/cms/journal/settings")
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  const taxonomy = await getJournalTaxonomy(actor, {})
  return (
    <>
      <AdminPageHeader
        title="Authors, categories and tags"
        back={{ href: "/admin/cms/journal", label: "Journal" }}
        description="Changes apply straight away. Something a story uses can't be deleted; changing a live address adds a redirect."
      />
      <JournalTerms
        taxonomy={taxonomy}
        canEdit={can(actor, { cms: ["publish"] })}
      />
    </>
  )
}

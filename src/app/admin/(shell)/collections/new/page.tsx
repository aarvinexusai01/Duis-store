import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { can, requireStaff } from "@/features/staff"

import { CollectionDetails } from "../_components/collection-details"

export const metadata: Metadata = { title: "New collection" }

export default function NewCollectionPage() {
  return (
    <>
      <AdminPageHeader
        title="New collection"
        back={{ href: "/admin/collections", label: "Collections" }}
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Gate />
      </Suspense>
    </>
  )
}

async function Gate() {
  const actor = await requireStaff("/admin/collections/new")
  if (!can(actor, { collection: ["create"] })) return <NoAccess />
  return <CollectionDetails collection={null} canEdit />
}

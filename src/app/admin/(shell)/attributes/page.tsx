import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminCatalogOptions } from "@/features/catalog"
import { can, requireStaff } from "@/features/staff"

import { AttributesEditor } from "./attributes-editor"

export const metadata: Metadata = { title: "Attributes" }

export default function AttributesPage() {
  return (
    <>
      <AdminPageHeader
        title="Attributes"
        description="Colours, sizes and descriptive filters (fit, sleeve…). Colours in the same filter group share one filter in the shop."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Attributes />
      </Suspense>
    </>
  )
}

async function Attributes() {
  const actor = await requireStaff("/admin/attributes")
  if (!can(actor, { catalog: ["read"] })) return <NoAccess />
  const options = await adminCatalogOptions(actor, {})
  return (
    <AttributesEditor
      attributes={options.attributes}
      canCreate={can(actor, { catalog: ["create"] })}
      canEdit={can(actor, { catalog: ["update"] })}
    />
  )
}

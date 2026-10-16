import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminListSizeCharts } from "@/features/catalog"
import { can, requireStaff } from "@/features/staff"

import { SizeChartEditor } from "./size-chart-editor"

export const metadata: Metadata = { title: "Size charts" }

export default function SizeChartsPage() {
  return (
    <>
      <AdminPageHeader
        title="Size charts"
        description="Garment measurements shown in the size guide. Attach a chart to a category."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Charts />
      </Suspense>
    </>
  )
}

async function Charts() {
  const actor = await requireStaff("/admin/size-charts")
  if (!can(actor, { catalog: ["read"] })) return <NoAccess />
  const charts = await adminListSizeCharts(actor, {})
  const canEdit = can(actor, { catalog: ["update"] })
  return (
    <div className="flex flex-col gap-6">
      {charts.map((chart) => (
        <SizeChartEditor key={chart.id} chart={chart} canEdit={canEdit} />
      ))}
      {can(actor, { catalog: ["create"] }) && (
        <SizeChartEditor chart={null} canEdit />
      )}
    </div>
  )
}

import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminCatalogOptions } from "@/features/catalog"
import { can, requireStaff } from "@/features/staff"

import { CategoryTree } from "./category-tree"

export const metadata: Metadata = { title: "Categories" }

export default function CategoriesPage() {
  return (
    <>
      <AdminPageHeader
        title="Categories"
        description="The shop's navigation tree. Order and nesting show in menus and listings."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Categories />
      </Suspense>
    </>
  )
}

async function Categories() {
  const actor = await requireStaff("/admin/categories")
  if (!can(actor, { catalog: ["read"] })) return <NoAccess />
  const options = await adminCatalogOptions(actor, {})
  return (
    <CategoryTree
      departments={options.departments}
      categories={options.categories}
      sizeCharts={options.sizeCharts}
      canCreate={can(actor, { catalog: ["create"] })}
      canEdit={can(actor, { catalog: ["update"] })}
    />
  )
}

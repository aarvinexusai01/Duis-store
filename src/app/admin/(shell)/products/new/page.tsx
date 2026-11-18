import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminCatalogOptions } from "@/features/catalog"
import { can, requireStaff } from "@/features/staff"

import { ProductForm } from "../_components/product-form"

export const metadata: Metadata = { title: "New product" }

export default function NewProductPage() {
  return (
    <>
      <AdminPageHeader
        title="New product"
        description={
          <>
            Save the details first; then generate sizes and add photos. New to
            this?{" "}
            <Link
              href="/admin/help/add-product"
              className="underline underline-offset-2"
            >
              Read how to add a product
            </Link>
            .
          </>
        }
        back={{ href: "/admin/products", label: "Products" }}
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <NewProduct />
      </Suspense>
    </>
  )
}

async function NewProduct() {
  const actor = await requireStaff("/admin/products/new")
  if (!can(actor, { catalog: ["create"] })) return <NoAccess />
  const options = await adminCatalogOptions(actor, {})
  return <ProductForm options={options} product={null} canEdit />
}

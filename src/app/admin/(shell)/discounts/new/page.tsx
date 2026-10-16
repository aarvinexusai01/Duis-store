import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { can, requireStaff } from "@/features/staff"

import { DiscountForm } from "../_components/discount-form"
import { targetOptions } from "../_components/options"

export const metadata: Metadata = { title: "New discount" }

export default function NewDiscountPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <NewDiscount />
    </Suspense>
  )
}

async function NewDiscount() {
  const actor = await requireStaff("/admin/discounts/new")
  if (!can(actor, { discount: ["create"] })) return <NoAccess />
  const options = await targetOptions(actor)
  return (
    <>
      <AdminPageHeader
        title="New discount"
        back={{ href: "/admin/discounts", label: "Discounts" }}
      />
      <DiscountForm discount={null} {...options} />
    </>
  )
}

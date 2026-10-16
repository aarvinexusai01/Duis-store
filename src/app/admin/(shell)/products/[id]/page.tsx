import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { adminCatalogOptions, adminGetProduct } from "@/features/catalog"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"

import { MediaManager } from "../_components/media-manager"
import { ProductActions } from "../_components/product-actions"
import { ProductForm } from "../_components/product-form"
import { VariantsPanel } from "../_components/variants-panel"

export const metadata: Metadata = { title: "Edit product" }

type Props = PageProps<"/admin/products/[id]">

export default function EditProductPage({ params }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <EditProduct params={params} />
    </Suspense>
  )
}

const TONE = { draft: "neutral", active: "good", archived: "bad" } as const

async function EditProduct({ params }: Pick<Props, "params">) {
  const { id } = await params
  const actor = await requireStaff(`/admin/products/${id}`)
  if (!can(actor, { catalog: ["read"] })) return <NoAccess />
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const [product, options] = await Promise.all([
    adminGetProduct(actor, { id }).catch((error) => {
      if (isDomainError(error)) notFound()
      throw error
    }),
    adminCatalogOptions(actor, {}),
  ])
  const colourAxis = options.attributes.find(
    (a) => a.code === "color" && product.axisAttributeIds.includes(a.id),
  )
  const usedColours = new Set(product.variants.map((v) => v.options.color))
  const colours = (colourAxis?.values ?? [])
    .filter((v) => usedColours.has(v.slug))
    .map((v) => ({ id: v.id, label: v.label }))
  const canEdit = can(actor, { catalog: ["update"] })

  return (
    <>
      <AdminPageHeader
        title={product.title}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge tone={TONE[product.status]}>
              {product.status}
            </StatusBadge>
            {product.variants.length} variants · {product.media.length} photos
          </span>
        }
        back={{ href: "/admin/products", label: "Products" }}
        actions={
          <ProductActions
            id={product.id}
            slug={product.slug}
            status={product.status}
            canPublish={can(actor, { catalog: ["publish", "archive"] })}
            canCreate={can(actor, { catalog: ["create"] })}
          />
        }
      />
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="media">Photos</TabsTrigger>
          <TabsTrigger value="variants">Variants &amp; stock</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-4">
          <ProductForm
            key={product.id}
            options={options}
            product={product}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="media" className="pt-4">
          <MediaManager
            productId={product.id}
            media={product.media}
            colours={colours}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="variants" className="pt-4">
          <VariantsPanel
            key={product.variants.map((v) => v.id).join()}
            product={product}
            options={options}
            canEdit={canEdit}
            canAdjust={can(actor, { inventory: ["adjust"] })}
          />
        </TabsContent>
      </Tabs>
    </>
  )
}

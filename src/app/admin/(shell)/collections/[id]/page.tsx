import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { adminCatalogOptions } from "@/features/catalog"
import { adminGetCollection } from "@/features/collections"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"

import { CollectionDetails } from "../_components/collection-details"
import { CollectionProducts } from "../_components/collection-products"
import { CollectionStatusActions } from "../_components/collection-status"
import { RuleBuilder } from "../_components/rule-builder"

export const metadata: Metadata = { title: "Edit collection" }

type Props = PageProps<"/admin/collections/[id]">

export default function EditCollectionPage({ params }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Edit params={params} />
    </Suspense>
  )
}

const TONE = { draft: "neutral", published: "good", archived: "bad" } as const

async function Edit({ params }: Pick<Props, "params">) {
  const { id } = await params
  const actor = await requireStaff(`/admin/collections/${id}`)
  if (!can(actor, { collection: ["read"] })) return <NoAccess />
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const collection = await adminGetCollection(actor, { id }).catch((error) => {
    if (isDomainError(error)) notFound()
    throw error
  })
  const canEdit = can(actor, { collection: ["update"] })
  const options =
    collection.type === "automatic"
      ? await adminCatalogOptions(actor, {})
      : null

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={collection.title}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge tone={TONE[collection.status]}>
              {collection.status}
            </StatusBadge>
            {collection.type === "automatic" ? "Automatic" : "Hand-picked"} ·{" "}
            {collection.products.length} products
          </span>
        }
        back={{ href: "/admin/collections", label: "Collections" }}
        actions={
          <CollectionStatusActions
            id={collection.id}
            slug={collection.slug}
            status={collection.status}
            canPublish={can(actor, { collection: ["publish"] })}
            canArchive={can(actor, { collection: ["archive"] })}
          />
        }
      />
      <CollectionDetails collection={collection} canEdit={canEdit} />
      {collection.type === "manual" ? (
        <CollectionProducts collection={collection} canEdit={canEdit} />
      ) : (
        options && (
          <RuleBuilder
            collection={collection}
            options={options}
            canEdit={canEdit}
          />
        )
      )}
    </div>
  )
}

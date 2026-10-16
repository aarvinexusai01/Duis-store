"use client"

import type { Route } from "next"
import Link from "next/link"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  archiveCollectionAction,
  publishCollectionAction,
} from "@/features/collections/admin-actions"
import { cn } from "@/lib/utils"

export function CollectionStatusActions({
  id,
  slug,
  status,
  canPublish,
  canArchive,
}: {
  id: string
  slug: string
  status: "draft" | "published" | "archived"
  canPublish: boolean
  canArchive: boolean
}) {
  const [pending, startTransition] = useTransition()
  return (
    <>
      {status === "published" && (
        <Link
          href={`/collections/${slug}` as Route}
          target="_blank"
          className={cn(buttonVariants({ variant: "outline" }), "rounded-sm")}
        >
          View in store
        </Link>
      )}
      {canPublish && status !== "published" && (
        <Button
          className="rounded-sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await publishCollectionAction(id)
              if (result.ok) toast.success("Published")
              else toast.error(result.message)
            })
          }
        >
          Publish
        </Button>
      )}
      {canArchive && status !== "archived" && (
        <Button
          variant="outline"
          className="rounded-sm text-destructive"
          disabled={pending}
          onClick={() =>
            window.confirm(
              "Archive this collection? It disappears from the store.",
            ) &&
            startTransition(async () => {
              const result = await archiveCollectionAction(id)
              if (result.ok) toast.success("Archived")
              else toast.error(result.message)
            })
          }
        >
          Archive
        </Button>
      )}
    </>
  )
}

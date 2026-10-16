"use client"

import type { Route } from "next"
import Link from "next/link"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  archiveProductAction,
  duplicateProductAction,
  publishProductAction,
} from "@/features/catalog/admin-actions"
import { cn } from "@/lib/utils"

export function ProductActions({
  id,
  slug,
  status,
  canPublish,
  canCreate,
}: {
  id: string
  slug: string
  status: "draft" | "active" | "archived"
  canPublish: boolean
  canCreate: boolean
}) {
  const [pending, startTransition] = useTransition()
  const act = (
    work: () => Promise<{ ok: boolean; message?: string }>,
    done: string,
  ) =>
    startTransition(async () => {
      const result = await work()
      if (result.ok) toast.success(done)
      else toast.error(result.message ?? "Something went wrong.")
    })
  return (
    <>
      {status === "active" && (
        <Link
          href={`/products/${slug}` as Route}
          target="_blank"
          className={cn(buttonVariants({ variant: "outline" }), "rounded-sm")}
        >
          View in store
        </Link>
      )}
      {canCreate && (
        <Button
          variant="outline"
          className="rounded-sm"
          disabled={pending}
          onClick={() => {
            const copy = window.prompt("URL slug for the copy", `${slug}-copy`)
            if (copy) act(() => duplicateProductAction(id, copy), "Copied")
          }}
        >
          Duplicate
        </Button>
      )}
      {canPublish && status !== "active" && (
        <Button
          className="rounded-sm"
          disabled={pending}
          onClick={() => act(() => publishProductAction(id), "Published")}
        >
          Publish
        </Button>
      )}
      {canPublish && status !== "archived" && (
        <Button
          variant="outline"
          className="rounded-sm text-destructive"
          disabled={pending}
          onClick={() => {
            if (
              window.confirm(
                "Archive this product? It disappears from the store; orders are kept.",
              )
            ) {
              act(() => archiveProductAction(id), "Archived")
            }
          }}
        >
          Archive
        </Button>
      )}
    </>
  )
}

"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  archiveDiscountAction,
  setDiscountActiveAction,
} from "@/features/discounts/admin-actions"

export function DiscountStatus({
  id,
  status,
  canUpdate,
  canArchive,
}: {
  id: string
  status: "active" | "paused" | "archived"
  canUpdate: boolean
  canArchive: boolean
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
  if (status === "archived") return null
  return (
    <>
      {canUpdate && (
        <Button
          variant="outline"
          className="rounded-sm"
          disabled={pending}
          onClick={() =>
            act(
              () => setDiscountActiveAction(id, status !== "active"),
              status === "active" ? "Paused" : "Resumed",
            )
          }
        >
          {status === "active" ? "Pause" : "Resume"}
        </Button>
      )}
      {canArchive && (
        <Button
          variant="outline"
          className="rounded-sm border-destructive/40 text-destructive"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Archive this discount? It stops for good."))
              return
            act(() => archiveDiscountAction(id), "Archived")
          }}
        >
          Archive
        </Button>
      )}
    </>
  )
}

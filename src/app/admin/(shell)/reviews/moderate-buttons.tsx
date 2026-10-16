"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { moderateReviewAction } from "@/features/reviews/actions"

export function ModerateButtons({
  reviewId,
  status,
}: {
  reviewId: string
  status: "pending" | "approved" | "rejected"
}) {
  const [pending, startTransition] = useTransition()
  const decide = (decision: "approved" | "rejected") =>
    startTransition(async () => {
      const note =
        decision === "rejected"
          ? (window.prompt("Why? (staff only, optional)") ?? undefined)
          : undefined
      const result = await moderateReviewAction({ reviewId, decision, note })
      if (result.ok)
        toast.success(decision === "approved" ? "Published" : "Rejected")
      else toast.error(result.message)
    })
  return (
    <span className="flex gap-2">
      {status !== "approved" && (
        <Button
          size="sm"
          className="rounded-sm"
          disabled={pending}
          onClick={() => decide("approved")}
        >
          Publish
        </Button>
      )}
      {status !== "rejected" && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-sm"
          disabled={pending}
          onClick={() => decide("rejected")}
        >
          {status === "approved" ? "Unpublish" : "Reject"}
        </Button>
      )}
    </span>
  )
}

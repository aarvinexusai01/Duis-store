"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  discardFailedJobAction,
  reprocessWebhookAction,
  retryFailedJobAction,
} from "@/features/system/admin-actions"

type Result = { ok: boolean; message?: string }

function useAct() {
  const [pending, startTransition] = useTransition()
  const act = (work: () => Promise<Result>, done: string) =>
    startTransition(async () => {
      const result = await work()
      if (result.ok) toast.success(done)
      else toast.error(result.message ?? "Something went wrong.")
    })
  return { pending, act }
}

export function JobActions({ queue, id }: { queue: string; id: string }) {
  const { pending, act } = useAct()
  return (
    <span className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        className="rounded-sm"
        onClick={() =>
          act(() => retryFailedJobAction(queue, id), "Queued again")
        }
      >
        Retry
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Discard this job? It won't run again.")) return
          act(() => discardFailedJobAction(queue, id), "Discarded")
        }}
      >
        Discard
      </Button>
    </span>
  )
}

export function WebhookActions({ id }: { id: string }) {
  const { pending, act } = useAct()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      className="rounded-sm"
      onClick={() => act(() => reprocessWebhookAction(id), "Queued again")}
    >
      Run again
    </Button>
  )
}

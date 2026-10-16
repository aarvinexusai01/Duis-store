"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import {
  unsubscribeMarketingAction,
  type UnsubscribeState,
} from "@/features/marketing/actions"

export function UnsubscribeForm({ u, t }: { u: string; t: string }) {
  const [state, action, pending] = useActionState<UnsubscribeState, FormData>(
    unsubscribeMarketingAction,
    { status: "idle" },
  )
  if (state.status === "done") {
    return (
      <p role="status" className="mt-4 text-sm">
        Done. You won&apos;t get marketing emails from us any more. Order
        updates still arrive. You can turn offers back on in your account.
      </p>
    )
  }
  return (
    <form action={action} className="mt-4 flex flex-col gap-4 text-sm">
      <p>Stop offers, drops and bag reminders by email?</p>
      <input type="hidden" name="u" value={u} />
      <input type="hidden" name="t" value={t} />
      <Button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-none px-6"
      >
        {pending ? "Saving…" : "Unsubscribe"}
      </Button>
      {state.status === "invalid" && (
        <p role="alert" className="text-destructive">
          This link isn&apos;t valid. Turn emails off in your account instead.
        </p>
      )}
    </form>
  )
}

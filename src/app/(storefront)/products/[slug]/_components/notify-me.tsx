"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import {
  subscribeStockAlertAction,
  type StockAlertState,
} from "@/features/alerts/actions"

/** "Tell me when it's back" for a sold-out size (one email, then done). */
export function NotifyMe({ variantId }: { variantId: string }) {
  const [state, action, pending] = useActionState<StockAlertState, FormData>(
    subscribeStockAlertAction,
    { status: "idle" },
  )
  if (state.status === "done" || state.status === "in_stock") {
    return (
      <p role="status" className="border border-ink p-3 text-sm">
        {state.message}
      </p>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="variantId" value={variantId} />
      <label htmlFor="notify-email" className="text-sm font-medium">
        Tell me when this size is back
      </label>
      <div className="flex gap-2">
        <input
          id="notify-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 min-w-0 flex-1 border border-ink bg-card px-3 text-sm"
        />
        <Button
          type="submit"
          disabled={pending}
          className="h-12 rounded-none px-5 text-sm font-semibold tracking-wider uppercase"
        >
          {pending ? "…" : "Notify me"}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </form>
  )
}

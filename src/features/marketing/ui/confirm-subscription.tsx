"use client"

import Link from "next/link"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"

import { confirmNewsletterSubscription, type ConfirmState } from "../actions"

export function ConfirmSubscription({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(
    confirmNewsletterSubscription,
    { status: "idle" },
  )

  if (state.status === "confirmed") {
    return (
      <p role="status" className="mt-6 text-lg">
        You&apos;re in. Watch your inbox for the next drop.{" "}
        <Link href="/" className="font-semibold underline">
          Back to the shop
        </Link>
      </p>
    )
  }
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "invalid" && (
        <p role="alert" className="font-medium text-destructive">
          This link has expired or was already used. Sign up again from the
          footer to get a new one.
        </p>
      )}
      <p>Click below to start getting drop alerts, restocks and offers.</p>
      <Button
        type="submit"
        disabled={pending || !token}
        className="h-12 rounded-none px-8 font-semibold tracking-wide uppercase"
      >
        {pending ? "Confirming…" : "Yes, subscribe me"}
      </Button>
    </form>
  )
}

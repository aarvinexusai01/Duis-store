"use client"

import { useRouter } from "next/navigation"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"

import { acceptAccountNoticeAction, type AccountNoticeState } from "../actions"
import { ConsentFields } from "./consent-fields"

/** The one-time prompt; the customer can sign out instead of agreeing. */
export function AccountNoticeForm({ next }: { next: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<AccountNoticeState, FormData>(
    acceptAccountNoticeAction,
    { message: null },
  )
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <ConsentFields purposes={["account", "age"]} />
      {state.message && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={pending}
          className="h-12 rounded-none px-6 font-semibold uppercase"
        >
          {pending ? "Saving…" : "Agree and continue"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-12 rounded-none"
          onClick={() =>
            void authClient.signOut().then(() => {
              router.replace("/")
              router.refresh()
            })
          }
        >
          Sign out instead
        </Button>
      </div>
    </form>
  )
}

"use client"

import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  grantGoodwillAction,
  setCodBlockAction,
} from "@/features/customers/admin-actions"

const field = "h-9 w-full rounded-sm border border-input bg-paper px-2 text-sm"

export function CodBlockForm({
  userId,
  blocked,
}: {
  userId: string
  blocked: boolean
}) {
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
    startTransition(async () => {
      const result = await setCodBlockAction({
        userId,
        blocked: !blocked,
        reason: blocked ? undefined : reason,
      })
      if (result.ok)
        toast.success(blocked ? "COD allowed again" : "COD blocked")
      else toast.error(result.message)
    })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {!blocked && (
        <label className="flex flex-col gap-1 text-sm">
          Reason
          <input
            name="reason"
            required
            minLength={3}
            maxLength={300}
            placeholder="e.g. refused two COD parcels"
            className={field}
          />
        </label>
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        className="self-start rounded-sm"
      >
        {blocked ? "Allow COD" : "Block COD"}
      </Button>
    </form>
  )
}

/** Promotional credit that expires (doc/10 P12); needs a note. */
export function GoodwillForm({ userId }: { userId: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await grantGoodwillAction({
        userId,
        amountPaise: Math.round(Number(form.get("amount")) * 100),
        note: String(form.get("note")),
        idempotencyKey: key,
      })
      if (result.ok) {
        toast.success("Credit added")
        formRef.current?.reset()
        setKey(crypto.randomUUID())
      } else toast.error(result.message)
    })
  }
  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Amount (₹)
        <input
          name="amount"
          type="number"
          min={1}
          max={10000}
          step="1"
          required
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Note (shown to the customer)
        <input
          name="note"
          required
          minLength={3}
          maxLength={300}
          className={field}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Goodwill credit expires after the promotional period.
      </p>
      <Button
        type="submit"
        size="sm"
        disabled={pending}
        className="self-start rounded-sm"
      >
        {pending ? "Adding…" : "Add credit"}
      </Button>
    </form>
  )
}

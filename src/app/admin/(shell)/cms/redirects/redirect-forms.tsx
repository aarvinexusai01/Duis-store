"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  createRedirectAction,
  deleteRedirectAction,
} from "@/features/redirects/admin-actions"

export function NewRedirectForm() {
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  return (
    <form
      className="grid gap-3 rounded-sm border bg-card p-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        startTransition(async () => {
          const result = await createRedirectAction({
            fromPath: String(data.get("from") ?? ""),
            toPath: String(data.get("to") ?? ""),
            permanent: data.get("temporary") !== "on",
          })
          if (result.ok) {
            setErrors({})
            form.reset()
            toast.success("Redirect added")
          } else {
            setErrors({
              from: result.fieldErrors?.fromPath?.[0],
              to: result.fieldErrors?.toPath?.[0],
            })
            if (!result.fieldErrors) toast.error(result.message)
          }
        })
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">From (old address)</span>
        <input
          name="from"
          required
          placeholder="/sale"
          aria-invalid={errors.from ? true : undefined}
          className="h-9 rounded-sm border bg-background px-3 aria-invalid:border-destructive"
        />
        {errors.from && (
          <span className="text-xs text-destructive">{errors.from}</span>
        )}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">To</span>
        <input
          name="to"
          required
          placeholder="/collections/summer-sale"
          aria-invalid={errors.to ? true : undefined}
          className="h-9 rounded-sm border bg-background px-3 aria-invalid:border-destructive"
        />
        {errors.to && (
          <span className="text-xs text-destructive">{errors.to}</span>
        )}
      </label>
      <label className="flex h-9 items-center gap-2">
        <input type="checkbox" name="temporary" />
        Temporary
      </label>
      <Button type="submit" className="rounded-sm" disabled={pending}>
        Add redirect
      </Button>
    </form>
  )
}

export function DeleteRedirectButton({
  id,
  from,
}: {
  id: string
  from: string
}) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="rounded-sm text-destructive"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Stop redirecting ${from}?`)) return
        startTransition(async () => {
          const result = await deleteRedirectAction(id)
          if (result.ok) toast.success("Redirect removed")
          else toast.error(result.message)
        })
      }}
    >
      Delete
    </Button>
  )
}

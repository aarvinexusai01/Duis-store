"use client"

import { useRef, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { addOrderNoteAction } from "@/features/orders/admin-actions"

export function NoteForm({ orderNumber }: { orderNumber: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = String(new FormData(event.currentTarget).get("body"))
    startTransition(async () => {
      const result = await addOrderNoteAction({ orderNumber, body })
      if (result.ok) formRef.current?.reset()
      else toast.error(result.message)
    })
  }
  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="order-note">
        Add a note
      </label>
      <textarea
        id="order-note"
        name="body"
        required
        maxLength={2000}
        rows={2}
        placeholder="Only staff see notes."
        className="rounded-sm border border-input bg-paper p-2 text-sm"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        className="self-end rounded-sm"
      >
        {pending ? "Saving…" : "Add note"}
      </Button>
    </form>
  )
}

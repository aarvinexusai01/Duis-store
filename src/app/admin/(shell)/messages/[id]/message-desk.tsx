"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { ContactStatus } from "@/features/contact/schemas"
import { updateContactMessageAction } from "@/features/contact/actions"

const NEXT: { status: ContactStatus; label: string }[] = [
  { status: "replied", label: "Mark replied" },
  { status: "closed", label: "Close" },
  { status: "new", label: "Reopen" },
]

export function MessageDesk({
  id,
  status,
  note,
}: {
  id: string
  status: ContactStatus
  note: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState(note ?? "")
  const save = (next: ContactStatus) =>
    startTransition(async () => {
      const result = await updateContactMessageAction({
        id,
        status: next,
        note: draft.trim(),
      })
      if (result.ok) toast.success("Saved")
      else toast.error(result.message)
    })

  return (
    <div className="flex flex-col gap-3 rounded-sm border bg-card p-4 text-sm">
      <label htmlFor="message-note" className="font-medium">
        Staff note
      </label>
      <textarea
        id="message-note"
        value={draft}
        maxLength={1000}
        rows={3}
        onChange={(event) => setDraft(event.target.value)}
        className="rounded-sm border bg-background p-2"
      />
      <div className="flex flex-wrap gap-2">
        {NEXT.filter((option) => option.status !== status).map((option) => (
          <Button
            key={option.status}
            size="sm"
            variant={option.status === "replied" ? "default" : "outline"}
            className="rounded-sm"
            disabled={pending}
            onClick={() => save(option.status)}
          >
            {option.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="rounded-sm"
          disabled={pending || draft.trim() === (note ?? "")}
          onClick={() => save(status)}
        >
          Save note
        </Button>
      </div>
    </div>
  )
}

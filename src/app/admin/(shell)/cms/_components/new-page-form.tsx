"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createPageAction } from "@/features/cms/admin-actions"
import { slugify } from "@/lib/slug"

export function NewPageForm() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [type, setType] = useState<"landing" | "static">("landing")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <Button className="rounded-sm" onClick={() => setOpen(true)}>
        New page
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-paper">
          <DialogHeader>
            <DialogTitle>New page</DialogTitle>
            <DialogDescription>
              It starts as an empty draft. The web address can&apos;t be changed
              later.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault()
              startTransition(async () => {
                const result = await createPageAction({ type, slug, title })
                if (result && !result.ok) {
                  setError(result.fieldErrors?.slug?.[0] ?? result.message)
                  toast.error(result.message)
                }
              })
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Name</span>
              <input
                required
                maxLength={120}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  if (!slugTouched) setSlug(slugify(event.target.value))
                }}
                className="h-9 rounded-sm border bg-card px-3"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Web address</span>
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">/pages/</span>
                <input
                  required
                  value={slug}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) => {
                    setSlugTouched(true)
                    setSlug(event.target.value)
                  }}
                  className="h-9 min-w-0 flex-1 rounded-sm border bg-card px-3"
                />
              </span>
              {error && (
                <span className="text-xs text-destructive">{error}</span>
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Kind</span>
              <select
                value={type}
                onChange={(event) =>
                  setType(event.target.value as "landing" | "static")
                }
                className="h-9 rounded-sm border bg-card px-2"
              >
                <option value="landing">Landing page (campaigns, edits)</option>
                <option value="static">Information page</option>
              </select>
            </label>
            <Button
              type="submit"
              className="self-end rounded-sm"
              disabled={pending}
            >
              {pending ? "Creating…" : "Create page"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

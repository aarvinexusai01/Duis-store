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
import { createPostAction } from "@/features/cms/admin-actions"
import { slugify } from "@/lib/slug"

export function NewPostForm({
  authors,
}: {
  authors: { id: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [touched, setTouched] = useState(false)
  const [authorId, setAuthorId] = useState(authors[0]?.id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <>
      <Button
        className="rounded-sm"
        disabled={authors.length === 0}
        onClick={() => setOpen(true)}
      >
        New story
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-paper">
          <DialogHeader>
            <DialogTitle>New story</DialogTitle>
            <DialogDescription>
              It starts as a draft. You can change everything later.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault()
              startTransition(async () => {
                const result = await createPostAction({ title, slug, authorId })
                if (result && !result.ok) {
                  setError(result.fieldErrors?.slug?.[0] ?? result.message)
                  toast.error(result.message)
                }
              })
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Title</span>
              <input
                required
                maxLength={140}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (!touched) setSlug(slugify(e.target.value))
                }}
                className="h-9 rounded-sm border bg-card px-3"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Web address</span>
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">/journal/</span>
                <input
                  required
                  value={slug}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => {
                    setTouched(true)
                    setSlug(e.target.value)
                  }}
                  className="h-9 min-w-0 flex-1 rounded-sm border bg-card px-3"
                />
              </span>
              {error && (
                <span className="text-xs text-destructive">{error}</span>
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Author</span>
              <select
                value={authorId}
                onChange={(e) => setAuthorId(e.target.value)}
                className="h-9 rounded-sm border bg-card px-2"
              >
                {authors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              className="self-end rounded-sm"
              disabled={pending}
            >
              {pending ? "Creating…" : "Create story"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

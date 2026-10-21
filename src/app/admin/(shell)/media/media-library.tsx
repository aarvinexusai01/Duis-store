"use client"

import type { Route } from "next"
import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { MediaListItem, MediaUse } from "@/features/media"
import {
  deleteMediaAction,
  mediaUsageAction,
  updateMediaAction,
} from "@/features/media/admin-actions"
import { cn } from "@/lib/utils"

const thumb = (key: string) => `/media/${key}/320.webp`
const kb = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`

export function MediaLibrary({
  items,
  view,
  canEdit,
  canDelete,
}: {
  items: MediaListItem[]
  view: "grid" | "list"
  canEdit: boolean
  canDelete: boolean
}) {
  const [selected, setSelected] = useState<MediaListItem | null>(null)
  if (items.length === 0)
    return (
      <p className="rounded-sm border bg-card p-6 text-sm text-muted-foreground">
        No images here.
      </p>
    )
  return (
    <>
      {view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(item)}
                className="group block w-full text-left"
              >
                <span className="relative block aspect-[4/5] overflow-hidden rounded-sm border bg-secondary">
                  {/* eslint-disable-next-line @next/next/no-img-element -- stored rendition */}
                  <img
                    src={thumb(item.key)}
                    alt={item.alt || item.filename || "Untitled image"}
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105"
                  />
                  {!item.used && (
                    <span className="absolute top-1 left-1">
                      <StatusBadge tone="neutral">Unused</StatusBadge>
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "mt-1 block truncate text-xs",
                    item.alt ? "" : "text-destructive",
                  )}
                >
                  {item.alt || "No alt text"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y rounded-sm border bg-card">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(item)}
                className="flex w-full items-center gap-3 p-2 text-left text-sm hover:bg-secondary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- stored rendition */}
                <img
                  src={thumb(item.key)}
                  alt=""
                  loading="lazy"
                  className="size-12 shrink-0 rounded-sm object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate",
                      !item.alt && "text-destructive",
                    )}
                  >
                    {item.alt || "No alt text"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.filename ?? "—"} · {item.width}×{item.height} ·{" "}
                    {kb(item.bytes)}
                  </span>
                </span>
                {!item.used && <StatusBadge tone="neutral">Unused</StatusBadge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <MediaDetail
          key={selected.id}
          item={selected}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

function MediaDetail({
  item,
  canEdit,
  canDelete,
  onClose,
}: {
  item: MediaListItem
  canEdit: boolean
  canDelete: boolean
  onClose: () => void
}) {
  const [alt, setAlt] = useState(item.alt)
  const [caption, setCaption] = useState(item.caption ?? "")
  const [focal, setFocal] = useState({ x: item.focalX, y: item.focalY })
  const [usage, setUsage] = useState<MediaUse[] | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    void mediaUsageAction(item.id).then((result) => {
      if (!cancelled && result.ok) setUsage(result.usage)
    })
    return () => {
      cancelled = true
    }
  }, [item.id])

  const dirty =
    alt !== item.alt ||
    caption !== (item.caption ?? "") ||
    focal.x !== item.focalX ||
    focal.y !== item.focalY

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-paper sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Image details</DialogTitle>
          <DialogDescription>
            {item.filename ?? "Uploaded image"} · {item.width}×{item.height} ·{" "}
            {kb(item.bytes)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <button
              type="button"
              disabled={!canEdit}
              aria-label="Click where the image should stay in frame when cropped"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                setFocal({
                  x:
                    Math.round(((event.clientX - box.left) / box.width) * 100) /
                    100,
                  y:
                    Math.round(((event.clientY - box.top) / box.height) * 100) /
                    100,
                })
              }}
              className="relative block w-full cursor-crosshair overflow-hidden rounded-sm border disabled:cursor-default"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- stored rendition */}
              <img
                src={`/media/${item.key}/640.webp`}
                alt={item.alt}
                className="block h-auto w-full"
              />
              <span
                aria-hidden
                className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper bg-rust/80 shadow"
                style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
              />
            </button>
            {canEdit && (
              <p className="mt-1 text-xs text-muted-foreground">
                Click the part that should stay in frame when the image is
                cropped (banners, tiles).
              </p>
            )}
          </div>
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault()
              startTransition(async () => {
                const result = await updateMediaAction({
                  id: item.id,
                  altText: alt,
                  caption: caption.trim() || null,
                  focalX: focal.x,
                  focalY: focal.y,
                })
                if (result.ok) {
                  toast.success("Saved")
                  onClose()
                } else toast.error(result.message)
              })
            }}
          >
            <fieldset disabled={!canEdit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="font-medium">Alt text</span>
                <textarea
                  value={alt}
                  maxLength={300}
                  rows={2}
                  onChange={(event) => setAlt(event.target.value)}
                  className="rounded-sm border bg-card p-2"
                />
                <span className="text-xs text-muted-foreground">
                  Describe the image for people who can&apos;t see it.
                </span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-medium">Caption (optional)</span>
                <input
                  value={caption}
                  maxLength={500}
                  onChange={(event) => setCaption(event.target.value)}
                  className="h-9 rounded-sm border bg-card px-3"
                />
              </label>
              {canEdit && (
                <Button
                  type="submit"
                  className="self-start rounded-sm"
                  disabled={pending || !dirty}
                >
                  Save
                </Button>
              )}
            </fieldset>
            <div className="border-t pt-3">
              <h3 className="font-medium">Where it&apos;s used</h3>
              {usage === null ? (
                <p className="text-muted-foreground">Checking…</p>
              ) : usage.length === 0 ? (
                <p className="text-muted-foreground">Not used anywhere.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {usage.map((use) => (
                    <li key={`${use.kind}-${use.href}-${use.label}`}>
                      <span className="text-muted-foreground">{use.kind}:</span>{" "}
                      <Link href={use.href as Route} className="underline">
                        {use.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canDelete && (
              <div className="border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-sm text-destructive"
                  disabled={pending || usage === null || usage.length > 0}
                  onClick={() => {
                    if (!window.confirm("Delete this image from the library?"))
                      return
                    startTransition(async () => {
                      const result = await deleteMediaAction(item.id)
                      if (result.ok) {
                        toast.success("Deleted")
                        onClose()
                      } else toast.error(result.message)
                    })
                  }}
                >
                  Delete image
                </Button>
                {usage !== null && usage.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Remove it from the places above first.
                  </p>
                )}
              </div>
            )}
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

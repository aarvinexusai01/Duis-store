"use client"

import { ImageIcon, UploadIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  searchMediaAction,
  searchProductsAction,
} from "@/features/cms/admin-actions"
import type { MediaListItem } from "@/features/media"
import { cn } from "@/lib/utils"

import { useLabels } from "./labels"
import { mediaSrc } from "@/lib/image-loader"

const thumb = (key: string) => mediaSrc(key, 320)

/** One image: shows the choice, opens the library to change it. */
export function MediaField({
  label,
  value,
  onChange,
  optional = false,
  error,
}: {
  label: string
  value: string | undefined
  onChange: (id: string | undefined) => void
  optional?: boolean
  error?: string
}) {
  const [open, setOpen] = useState(false)
  const labels = useLabels()
  const media = value ? labels.media.get(value) : undefined
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground"> (optional)</span>
        )}
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={
            value
              ? `Change ${label.toLowerCase()}`
              : `Choose ${label.toLowerCase()}`
          }
          className={cn(
            "relative flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-sm border bg-secondary",
            error && "border-destructive",
          )}
        >
          {media ? (
            // eslint-disable-next-line @next/next/no-img-element -- fixed stored rendition
            <img
              src={thumb(media.key)}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
          )}
        </button>
        <div className="flex flex-col items-start gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-sm"
            onClick={() => setOpen(true)}
          >
            {value ? "Change" : "Choose image"}
          </Button>
          {value && optional && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-xs text-muted-foreground underline"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <MediaLibraryDialog
        open={open}
        onOpenChange={setOpen}
        onPick={(item) => {
          labels.addMedia(item)
          onChange(item.id)
          setOpen(false)
        }}
      />
    </div>
  )
}

/** The media library in a dialog: search, upload, pick. */
export function MediaLibraryDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (item: MediaListItem) => void
}) {
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<MediaListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pending, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = (q: string, nextPage: number) =>
    startTransition(async () => {
      const result = await searchMediaAction({
        q: q || undefined,
        page: nextPage,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setItems((current) =>
        nextPage === 1 ? result.items : [...current, ...result.items],
      )
      setTotal(result.total)
      setPage(nextPage)
    })

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => load(query, 1), 250)
    return () => clearTimeout(timer)
  }, [open, query])

  const upload = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    const body = new FormData()
    body.set("file", file)
    const response = await fetch("/api/media/upload", { method: "POST", body })
    const json = await response.json().catch(() => null)
    setUploading(false)
    if (fileInput.current) fileInput.current.value = ""
    if (!response.ok) {
      toast.error(json?.error?.message ?? "Upload failed")
      return
    }
    onPick({
      id: json.id,
      key: json.storageKey,
      width: json.width,
      height: json.height,
      alt: "",
      caption: null,
      focalX: 0.5,
      focalY: 0.5,
      filename: file.name,
      bytes: file.size,
      used: false,
      createdAt: new Date(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto bg-paper sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose an image</DialogTitle>
          <DialogDescription>
            Pick from the library or upload a new one (JPEG, PNG or WebP).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="media-search" className="sr-only">
            Search images
          </label>
          <input
            id="media-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by alt text or file name"
            className="h-9 min-w-0 flex-1 rounded-sm border bg-card px-3 text-sm"
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            id="media-upload"
            onChange={(event) => upload(event.target.files)}
          />
          <Button
            type="button"
            size="sm"
            className="rounded-sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <UploadIcon className="size-4" aria-hidden />
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item)}
                className="group relative block aspect-[4/5] w-full overflow-hidden rounded-sm border bg-secondary focus-visible:ring-2 focus-visible:ring-ink"
                title={item.alt || item.filename || "Image"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed stored rendition */}
                <img
                  src={thumb(item.key)}
                  alt={item.alt || item.filename || "Untitled image"}
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
            </li>
          ))}
        </ul>
        {items.length === 0 && !pending && (
          <p className="text-sm text-muted-foreground">No images found.</p>
        )}
        {items.length < total && (
          <Button
            type="button"
            variant="outline"
            className="self-center rounded-sm"
            disabled={pending}
            onClick={() => load(query, page + 1)}
          >
            {pending ? "Loading…" : "Load more"}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Several products, in order: search to add, remove with ×. */
export function ProductListField({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: string[]
  onChange: (ids: string[]) => void
  error?: string
}) {
  const labels = useLabels()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<
    { id: string; label: string; imageKey: string | null }[]
  >([])
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (query.trim().length < 2) return
    const timer = setTimeout(
      () =>
        startTransition(async () => {
          const result = await searchProductsAction(query)
          if (result.ok) setResults(result.items)
        }),
      250,
    )
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <ul className="flex flex-col gap-1">
        {value.map((id) => (
          <li
            key={id}
            className="flex items-center justify-between gap-2 rounded-sm border bg-card px-2 py-1"
          >
            <span className="truncate">
              {labels.products.get(id) ?? "Product"}
            </span>
            <button
              type="button"
              aria-label={`Remove ${labels.products.get(id) ?? "product"}`}
              onClick={() => onChange(value.filter((v) => v !== id))}
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search products to add"
        aria-label={`Add to ${label.toLowerCase()}`}
        className="h-9 rounded-sm border bg-card px-3"
      />
      {query.trim().length >= 2 && results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-sm border bg-card">
          {results
            .filter((r) => !value.includes(r.id))
            .map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    labels.addProduct(r.id, r.label)
                    onChange([...value, r.id])
                    setQuery("")
                    setResults([])
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-secondary"
                >
                  {r.label}
                </button>
              </li>
            ))}
        </ul>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** Several of a fixed list (collections, categories), in order. */
export function OptionListField({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string
  options: { id: string; label: string }[]
  value: string[]
  onChange: (ids: string[]) => void
  error?: string
}) {
  const name = (id: string) =>
    options.find((o) => o.id === id)?.label.replace(/^(– )+/, "") ??
    "Unavailable"
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <ul className="flex flex-col gap-1">
        {value.map((id) => (
          <li
            key={id}
            className="flex items-center justify-between gap-2 rounded-sm border bg-card px-2 py-1"
          >
            <span className="truncate">{name(id)}</span>
            <button
              type="button"
              aria-label={`Remove ${name(id)}`}
              onClick={() => onChange(value.filter((v) => v !== id))}
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <select
        value=""
        aria-label={`Add to ${label.toLowerCase()}`}
        onChange={(event) => {
          if (event.target.value) onChange([...value, event.target.value])
        }}
        className="h-9 rounded-sm border bg-card px-2"
      >
        <option value="">Add…</option>
        {options
          .filter((o) => !value.includes(o.id))
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

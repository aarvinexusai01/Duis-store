"use client"

import { ImagePlusIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

type Photo = { id: string; preview: string }

/**
 * Up to `max` photos for an exchange request or a review. Each is uploaded
 * as soon as it is chosen (re-encoded on the server, metadata removed); the
 * form submits only the photo ids.
 */
export function PhotoPicker({
  max = 3,
  onChange,
}: {
  max?: number
  onChange: (ids: string[]) => void
}) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)

  const update = (next: Photo[]) => {
    setPhotos(next)
    onChange(next.map((p) => p.id))
  }

  const add = async (files: FileList | null) => {
    if (!files) return
    setBusy(true)
    const next = [...photos]
    for (const file of [...files].slice(0, max - photos.length)) {
      const body = new FormData()
      body.set("file", file)
      const response = await fetch("/api/photos", { method: "POST", body })
      const json = (await response.json().catch(() => ({}))) as {
        id?: string
        error?: { message?: string }
      }
      if (!response.ok || !json.id) {
        toast.error(json.error?.message ?? "That photo couldn't be added.")
        continue
      }
      next.push({ id: json.id, preview: URL.createObjectURL(file) })
    }
    update(next)
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((photo) => (
        <span
          key={photo.id}
          className="relative size-20 overflow-hidden border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob URL) */}
          <img src={photo.preview} alt="" className="size-full object-cover" />
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => update(photos.filter((p) => p.id !== photo.id))}
            className="absolute top-0.5 right-0.5 bg-ink/80 p-0.5 text-paper"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      {photos.length < max && (
        <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 border border-dashed text-xs text-muted-foreground hover:bg-secondary">
          <ImagePlusIcon aria-hidden className="size-5" />
          {busy ? "Adding…" : "Add photo"}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void add(e.target.files)
              e.target.value = ""
            }}
          />
        </label>
      )}
    </div>
  )
}

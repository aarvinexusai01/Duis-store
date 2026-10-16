"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { AdminProduct } from "@/features/catalog"
import { setProductMediaAction } from "@/features/catalog/admin-actions"

type Item = AdminProduct["media"][number]

/** Product photos: upload, order, colour assignment and alt text. */
export function MediaManager({
  productId,
  media,
  colours,
  canEdit,
}: {
  productId: string
  media: Item[]
  colours: { id: string; label: string }[]
  canEdit: boolean
}) {
  const [items, setItems] = useState(media)
  const [uploading, setUploading] = useState(false)
  const [pending, startTransition] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(items) !== JSON.stringify(media)

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    const added: Item[] = []
    for (const file of Array.from(files)) {
      const body = new FormData()
      body.set("file", file)
      const response = await fetch("/api/media/upload", {
        method: "POST",
        body,
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        toast.error(`${file.name}: ${json?.error?.message ?? "upload failed"}`)
        continue
      }
      if (!items.some((i) => i.mediaId === json.id)) {
        added.push({
          mediaId: json.id,
          key: json.storageKey,
          alt: "",
          colorValueId: null,
          width: json.width,
          height: json.height,
        })
      }
    }
    setItems((current) => [...current, ...added])
    setUploading(false)
    if (fileInput.current) fileInput.current.value = ""
  }

  const move = (index: number, by: number) =>
    setItems((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item!)
      return next
    })

  const save = () =>
    startTransition(async () => {
      const result = await setProductMediaAction({
        productId,
        items: items.map((i) => ({
          mediaId: i.mediaId,
          colorValueId: i.colorValueId,
          altOverride: i.alt || null,
        })),
      })
      if (result.ok) toast.success("Photos saved")
      else toast.error(result.message)
    })

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item, index) => (
          <li
            key={item.mediaId}
            className="flex gap-3 rounded-sm border bg-card p-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- stored rendition */}
            <img
              src={`/media/${item.key}/320.webp`}
              alt=""
              className="h-28 w-22 shrink-0 bg-secondary object-cover"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
              <span className="text-xs text-muted-foreground">
                {index === 0 ? "Main photo" : `Photo ${index + 1}`}
              </span>
              <label className="flex flex-col gap-0.5 text-xs">
                Colour
                <select
                  value={item.colorValueId ?? ""}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setItems(
                      items.map((i) =>
                        i.mediaId === item.mediaId
                          ? { ...i, colorValueId: e.target.value || null }
                          : i,
                      ),
                    )
                  }
                  className="h-8 rounded-sm border border-input bg-card px-1 text-sm"
                >
                  <option value="">All colours</option>
                  {colours.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                Alt text
                <input
                  value={item.alt}
                  disabled={!canEdit}
                  maxLength={200}
                  onChange={(e) =>
                    setItems(
                      items.map((i) =>
                        i.mediaId === item.mediaId
                          ? { ...i, alt: e.target.value }
                          : i,
                      ),
                    )
                  }
                  className="h-8 rounded-sm border border-input bg-card px-1 text-sm"
                />
              </label>
              {canEdit && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                    <span className="sr-only">Move earlier</span>
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                    <span className="sr-only">Move later</span>
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      setItems(items.filter((i) => i.mediaId !== item.mediaId))
                    }
                  >
                    <Trash2Icon />
                    <span className="sr-only">Remove photo</span>
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No photos yet. A product needs at least one to be published.
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="sr-only"
            id="media-upload"
            onChange={(e) => upload(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            className="rounded-sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <UploadIcon /> {uploading ? "Uploading…" : "Upload photos"}
          </Button>
          <Button
            type="button"
            className="rounded-sm"
            disabled={!dirty || pending}
            onClick={save}
          >
            {pending ? "Saving…" : "Save photos"}
          </Button>
        </div>
      )}
    </div>
  )
}

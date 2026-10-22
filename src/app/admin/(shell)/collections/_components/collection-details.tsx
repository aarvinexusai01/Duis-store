"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { AdminCollection } from "@/features/collections"
import {
  createCollectionAction,
  updateCollectionAction,
} from "@/features/collections/admin-actions"
import { slugify } from "@/lib/slug"

const input = "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm"

async function uploadOne(
  file: File,
): Promise<{ id: string; key: string } | null> {
  const body = new FormData()
  body.set("file", file)
  const response = await fetch("/api/media/upload", { method: "POST", body })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    toast.error(json?.error?.message ?? "Upload failed")
    return null
  }
  return { id: json.id, key: json.storageKey }
}

function ImagePicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: { id: string; key: string } | null
  onChange: (value: { id: string; key: string } | null) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {value && (
        // eslint-disable-next-line @next/next/no-img-element -- stored rendition
        <img
          src={`/media/${value.key}/640.webp`}
          alt=""
          className="h-28 w-full rounded-sm bg-secondary object-cover"
        />
      )}
      {!disabled && (
        <div className="flex gap-2">
          <label className="cursor-pointer rounded-sm border px-2 py-1 text-xs hover:bg-secondary">
            {value ? "Replace" : "Upload"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) onChange(await uploadOne(file))
              }}
            />
          </label>
          {value && (
            <button
              type="button"
              className="text-xs underline"
              onClick={() => onChange(null)}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function CollectionDetails({
  collection,
  canEdit,
}: {
  collection: AdminCollection | null
  canEdit: boolean
}) {
  const creating = collection === null
  const [type, setType] = useState<"manual" | "automatic">(
    collection?.type ?? "manual",
  )
  const [title, setTitle] = useState(collection?.title ?? "")
  const [slug, setSlug] = useState(collection?.slug ?? "")
  const [image, setImage] = useState(collection?.image ?? null)
  const [banner, setBanner] = useState(collection?.banner ?? null)
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "").trim()
    const fields = {
      title,
      slug,
      description: text("description") || null,
      sortMode: text("sortMode") as AdminCollection["sortMode"],
      imageMediaId: image?.id ?? null,
      bannerMediaId: banner?.id ?? null,
      seoTitle: text("seoTitle") || null,
      seoDescription: text("seoDescription") || null,
      noindex: form.get("noindex") === "on",
    }
    startTransition(async () => {
      const result = creating
        ? await createCollectionAction(
            type === "manual"
              ? { ...fields, type: "manual" }
              : // A new automatic collection starts with one rule; refine it after saving.
                {
                  ...fields,
                  type: "automatic",
                  rules: [{ field: "created_within_days", days: 30 }],
                  ruleMatch: "all",
                },
          )
        : await updateCollectionAction({
            ...fields,
            id: collection.id,
            expectedVersion: collection.version,
          })
      if (result.ok) toast.success("Collection saved")
      else {
        setErrors(result.fieldErrors ?? {})
        toast.error(result.message)
      }
    })
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <fieldset
        disabled={!canEdit || pending}
        className="flex flex-col gap-3 rounded-sm border bg-card p-4 text-sm"
      >
        {creating && (
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={type === "manual"}
                onChange={() => setType("manual")}
              />{" "}
              Hand-picked
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={type === "automatic"}
                onChange={() => setType("automatic")}
              />{" "}
              Automatic (rules)
            </label>
          </div>
        )}
        <label className="flex flex-col gap-1">
          Title
          <input
            value={title}
            required
            onChange={(e) => {
              setTitle(e.target.value)
              if (creating) setSlug(slugify(e.target.value))
            }}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1">
          URL slug
          <input
            value={slug}
            required
            onChange={(e) => setSlug(e.target.value)}
            className={input}
          />
          {errors.slug && (
            <span className="text-xs text-destructive">{errors.slug[0]}</span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          Description
          <textarea
            name="description"
            defaultValue={collection?.description ?? ""}
            rows={3}
            className="rounded-sm border border-input bg-card px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          Product order
          <select
            name="sortMode"
            defaultValue={collection?.sortMode ?? "manual"}
            className={input}
          >
            <option value="manual">As arranged</option>
            <option value="newest">Newest first</option>
            <option value="best_selling">Best selling</option>
            <option value="price_asc">Price, low to high</option>
            <option value="price_desc">Price, high to low</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          SEO title
          <input
            name="seoTitle"
            defaultValue={collection?.seoTitle ?? ""}
            maxLength={70}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1">
          SEO description
          <textarea
            name="seoDescription"
            defaultValue={collection?.seoDescription ?? ""}
            maxLength={170}
            rows={2}
            className="rounded-sm border border-input bg-card px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="noindex"
            defaultChecked={collection?.noindex}
          />{" "}
          Hide from search engines
        </label>
        {canEdit && (
          <Button type="submit" className="w-fit rounded-sm" disabled={pending}>
            {pending
              ? "Saving…"
              : creating
                ? "Create collection"
                : "Save details"}
          </Button>
        )}
      </fieldset>
      <div className="flex flex-col gap-4 rounded-sm border bg-card p-4">
        <ImagePicker
          label="Card image"
          value={image}
          onChange={setImage}
          disabled={!canEdit}
        />
        <ImagePicker
          label="Banner"
          value={banner}
          onChange={setBanner}
          disabled={!canEdit}
        />
        <p className="text-xs text-muted-foreground">
          Image changes are saved with the details.
        </p>
      </div>
    </form>
  )
}

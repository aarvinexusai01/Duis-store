"use client"

import { PlusIcon } from "lucide-react"
import { useId, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { CatalogOptions } from "@/features/catalog"
import { createAttributeValueAction } from "@/features/catalog/admin-actions"
import { slugify } from "@/lib/slug"

type Axis = CatalogOptions["attributes"][number]

const input =
  "h-8 rounded-sm border border-input bg-card px-2 text-sm text-foreground"

/** The shop's colour filter entries: a colour without a family is its own. */
export function filterFamilies(axis: Axis): string[] {
  return [
    ...new Set(axis.values.map((value) => value.filterGroup ?? value.slug)),
  ].sort()
}

const titleCase = (slug: string) =>
  slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")

/**
 * "+ New colour" (or size) beside the values in Generate variants, so a
 * product with a new colour doesn't need a trip to Attributes first. It
 * saves through `catalog.createAttributeValue`, the same as the Attributes
 * page, and hands the new value back to be ticked.
 *
 * It sits inside the generator's form, so it has no form of its own and no
 * named inputs: Enter saves the value instead of generating variants.
 */
export function NewOptionValue({
  axis,
  onAdded,
}: {
  axis: Axis
  /** The value to tick: the new one, or the existing one with that name. */
  onAdded: (valueId: string) => void
}) {
  const id = useId()
  const swatch = axis.kind === "swatch"
  const noun = axis.name.toLowerCase()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [hex, setHex] = useState("#808080")
  // "" is "its own filter entry".
  const [family, setFamily] = useState("")
  const [pending, startTransition] = useTransition()

  const close = () => {
    setOpen(false)
    setLabel("")
    setFamily("")
  }

  const save = () => {
    const name = label.trim()
    const slug = slugify(name)
    if (!slug) {
      toast.error(`Give the new ${noun} a name.`)
      return
    }
    const existing = axis.values.find((value) => value.slug === slug)
    if (existing) {
      onAdded(existing.id)
      toast.info(`${existing.label} already exists, so it's ticked.`)
      close()
      return
    }
    startTransition(async () => {
      const result = await createAttributeValueAction({
        attributeId: axis.id,
        label: name,
        slug,
        swatchHex: swatch ? hex : null,
        filterGroup: swatch && family ? family : null,
        position: axis.values.length,
      })
      if (result.ok) {
        onAdded(result.id)
        toast.success(`${name} added`)
        close()
      } else toast.error(result.message)
    })
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-sm"
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-3.5" aria-hidden />
        New {noun}
      </Button>
    )
  }

  return (
    <div
      role="group"
      aria-label={`New ${noun}`}
      className="flex w-full flex-wrap items-end gap-2 rounded-sm border border-dashed p-2"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          save()
        } else if (event.key === "Escape") close()
      }}
    >
      {swatch && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Swatch
          <input
            type="color"
            value={hex}
            onChange={(event) => setHex(event.target.value)}
            className="h-8 w-10 rounded-sm border"
          />
        </label>
      )}
      <label
        htmlFor={`${id}-name`}
        className="flex flex-col gap-1 text-xs text-muted-foreground"
      >
        Name
        <input
          id={`${id}-name`}
          autoFocus
          value={label}
          maxLength={60}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={swatch ? "e.g. Olive" : "e.g. 4XL"}
          className={`${input} w-36`}
        />
      </label>
      {swatch && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Shop filter
          <select
            value={family}
            onChange={(event) => setFamily(event.target.value)}
            className={`${input} w-40`}
          >
            <option value="">Its own colour</option>
            {filterFamilies(axis).map((slug) => (
              <option key={slug} value={slug}>
                Under {titleCase(slug)}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-sm"
        disabled={pending}
        onClick={save}
      >
        {pending ? "Adding…" : "Add"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 rounded-sm"
        onClick={close}
      >
        Cancel
      </Button>
    </div>
  )
}

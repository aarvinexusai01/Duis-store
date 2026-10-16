"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import type { CatalogOptions } from "@/features/catalog"
import {
  createAttributeAction,
  createAttributeValueAction,
  updateAttributeValueAction,
} from "@/features/catalog/admin-actions"
import { slugify } from "@/lib/slug"

type Attribute = CatalogOptions["attributes"][number]
type Value = Attribute["values"][number]
const input = "h-8 rounded-sm border border-input bg-card px-2 text-sm"

export function AttributesEditor({
  attributes,
  canCreate,
  canEdit,
}: {
  attributes: Attribute[]
  canCreate: boolean
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()

  const createAttribute = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const name = String(form.get("name")).trim()
    startTransition(async () => {
      const result = await createAttributeAction({
        name,
        code: slugify(name),
        kind: form.get("kind") === "swatch" ? "swatch" : "text",
        isVariantAxis: form.get("axis") === "on",
        isFilterable: true,
        position: attributes.length,
      })
      if (result.ok) {
        formElement.reset()
        toast.success("Attribute added")
      } else toast.error(result.message)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {attributes.map((attribute) => (
        <section key={attribute.id} className="rounded-sm border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <h2 className="font-semibold">{attribute.name}</h2>
            <span className="text-xs text-muted-foreground">
              {attribute.code}
            </span>
            {attribute.isVariantAxis ? (
              <StatusBadge tone="info">variant option</StatusBadge>
            ) : (
              <StatusBadge>descriptive</StatusBadge>
            )}
          </header>
          <ul className="divide-y">
            {attribute.values.map((value) => (
              <ValueRow
                key={value.id}
                value={value}
                swatch={attribute.kind === "swatch"}
                canEdit={canEdit}
              />
            ))}
          </ul>
          {canCreate && <NewValue attribute={attribute} />}
        </section>
      ))}
      {canCreate && (
        <form
          onSubmit={createAttribute}
          className="flex flex-wrap items-end gap-3 rounded-sm border bg-card p-4 text-sm"
        >
          <label className="flex flex-col gap-1">
            New attribute
            <input
              name="name"
              required
              placeholder="Neckline"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Type
            <select name="kind" className={input}>
              <option value="text">Text</option>
              <option value="swatch">Colour swatch</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="axis" /> Customers choose it per
            variant
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            Add attribute
          </Button>
        </form>
      )}
    </div>
  )
}

function ValueRow({
  value,
  swatch,
  canEdit,
}: {
  value: Value
  swatch: boolean
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState({
    label: value.label,
    swatchHex: value.swatchHex ?? "#000000",
    filterGroup: value.filterGroup ?? "",
    position: value.position,
  })
  const dirty =
    draft.label !== value.label ||
    (swatch && draft.swatchHex !== (value.swatchHex ?? "#000000")) ||
    draft.filterGroup !== (value.filterGroup ?? "") ||
    draft.position !== value.position
  const save = () =>
    startTransition(async () => {
      const result = await updateAttributeValueAction({
        id: value.id,
        label: draft.label,
        ...(swatch ? { swatchHex: draft.swatchHex } : {}),
        filterGroup: draft.filterGroup ? slugify(draft.filterGroup) : null,
        position: draft.position,
      })
      if (result.ok) toast.success("Saved")
      else toast.error(result.message)
    })
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-sm">
      {swatch && (
        <input
          type="color"
          aria-label={`Swatch for ${value.label}`}
          value={draft.swatchHex}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, swatchHex: e.target.value })}
          className="h-7 w-9 cursor-pointer rounded-sm border"
        />
      )}
      <input
        aria-label="Label"
        value={draft.label}
        disabled={!canEdit}
        onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        className={`${input} w-40`}
      />
      <span className="text-xs text-muted-foreground">{value.slug}</span>
      <input
        aria-label="Filter group"
        placeholder="filter group"
        value={draft.filterGroup}
        disabled={!canEdit}
        onChange={(e) => setDraft({ ...draft, filterGroup: e.target.value })}
        className={`${input} w-32`}
      />
      <input
        aria-label="Order"
        type="number"
        min={0}
        value={draft.position}
        disabled={!canEdit}
        onChange={(e) =>
          setDraft({ ...draft, position: Number(e.target.value) })
        }
        className={`${input} w-16`}
      />
      {canEdit && dirty && (
        <Button size="sm" variant="outline" disabled={pending} onClick={save}>
          Save
        </Button>
      )}
    </li>
  )
}

function NewValue({ attribute }: { attribute: Attribute }) {
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const label = String(form.get("label")).trim()
    startTransition(async () => {
      const result = await createAttributeValueAction({
        attributeId: attribute.id,
        label,
        slug: slugify(label),
        swatchHex:
          attribute.kind === "swatch" ? String(form.get("swatchHex")) : null,
        filterGroup: String(form.get("filterGroup") ?? "").trim()
          ? slugify(String(form.get("filterGroup")))
          : null,
        position: attribute.values.length,
      })
      if (result.ok) {
        formElement.reset()
        toast.success("Value added")
      } else toast.error(result.message)
    })
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 border-t px-4 py-2 text-sm"
    >
      {attribute.kind === "swatch" && (
        <input
          type="color"
          name="swatchHex"
          defaultValue="#000000"
          aria-label="Swatch"
          className="h-7 w-9 rounded-sm border"
        />
      )}
      <input
        name="label"
        required
        placeholder={`New ${attribute.name.toLowerCase()}`}
        aria-label="New value"
        className={`${input} w-40`}
      />
      {attribute.kind === "swatch" && (
        <input
          name="filterGroup"
          placeholder="filter group"
          aria-label="Filter group"
          className={`${input} w-32`}
        />
      )}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Add
      </Button>
    </form>
  )
}

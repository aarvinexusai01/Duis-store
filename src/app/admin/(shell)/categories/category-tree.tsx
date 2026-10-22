"use client"

import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { CatalogOptions } from "@/features/catalog"
import {
  createCategoryAction,
  moveCategoryAction,
  updateCategoryAction,
} from "@/features/catalog/admin-actions"
import { slugify } from "@/lib/slug"

type Category = CatalogOptions["categories"][number]
type Editing =
  | { mode: "create"; departmentId: string; parentId: string | null }
  | { mode: "edit"; category: Category }

const input = "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm"

export function CategoryTree({
  departments,
  categories,
  sizeCharts,
  canCreate,
  canEdit,
}: {
  departments: CatalogOptions["departments"]
  categories: Category[]
  sizeCharts: CatalogOptions["sizeCharts"]
  canCreate: boolean
  canEdit: boolean
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [pending, startTransition] = useTransition()

  const siblings = (c: Category) =>
    categories
      .filter(
        (x) => x.parentId === c.parentId && x.departmentId === c.departmentId,
      )
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  const reorder = (c: Category, by: number) =>
    startTransition(async () => {
      const list = siblings(c)
      const index = list.findIndex((x) => x.id === c.id)
      const swap = list[index + by]
      if (!swap) return
      // Renumber the whole sibling list so positions stay distinct.
      const next = [...list]
      next.splice(index, 1)
      next.splice(index + by, 0, c)
      for (const [position, item] of next.entries()) {
        if (item.position !== position) {
          const result = await updateCategoryAction({ id: item.id, position })
          if (!result.ok) {
            toast.error(result.message)
            return
          }
        }
      }
    })

  return (
    <div className="flex flex-col gap-6">
      {departments.map((department) => {
        const rows = categories.filter((c) => c.departmentId === department.id)
        return (
          <section key={department.id} className="rounded-sm border bg-card">
            <header className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="font-semibold">{department.name}</h2>
              {canCreate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditing({
                      mode: "create",
                      departmentId: department.id,
                      parentId: null,
                    })
                  }
                >
                  <PlusIcon /> Top-level category
                </Button>
              )}
            </header>
            <ul className="divide-y text-sm">
              {rows.map((c) => {
                const list = siblings(c)
                const index = list.findIndex((x) => x.id === c.id)
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 px-4 py-1.5"
                    style={{ paddingLeft: 16 + c.depth * 20 }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{c.name}</span>{" "}
                      <span className="text-xs text-muted-foreground">
                        /{c.slug} · {c.productCount} products
                        {c.defaultHsnCode && ` · HSN ${c.defaultHsnCode}`}
                      </span>
                    </span>
                    {!c.isActive && (
                      <StatusBadge tone="warn">hidden</StatusBadge>
                    )}
                    {canEdit && (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={pending || index <= 0}
                          onClick={() => reorder(c, -1)}
                        >
                          <ArrowUpIcon />
                          <span className="sr-only">Move {c.name} up</span>
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={pending || index >= list.length - 1}
                          onClick={() => reorder(c, 1)}
                        >
                          <ArrowDownIcon />
                          <span className="sr-only">Move {c.name} down</span>
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() =>
                            setEditing({ mode: "edit", category: c })
                          }
                        >
                          <PencilIcon />
                          <span className="sr-only">Edit {c.name}</span>
                        </Button>
                      </>
                    )}
                    {canCreate && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() =>
                          setEditing({
                            mode: "create",
                            departmentId: department.id,
                            parentId: c.id,
                          })
                        }
                      >
                        <PlusIcon />
                        <span className="sr-only">
                          Add a category inside {c.name}
                        </span>
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      <CategoryDialog
        editing={editing}
        categories={categories}
        sizeCharts={sizeCharts}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function CategoryDialog({
  editing,
  categories,
  sizeCharts,
  onClose,
}: {
  editing: Editing | null
  categories: Category[]
  sizeCharts: CatalogOptions["sizeCharts"]
  onClose: () => void
}) {
  const current = editing?.mode === "edit" ? editing.category : null
  const [slug, setSlug] = useState("")
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "").trim()
    const fields = {
      name: text("name"),
      slug: text("slug"),
      description: text("description") || null,
      defaultHsnCode: text("hsn") || null,
      sizeChartId: text("sizeChartId") || null,
      exchangeAllowed: form.get("exchangeAllowed") === "on",
    }
    startTransition(async () => {
      let result
      if (editing.mode === "create") {
        result = await createCategoryAction({
          ...fields,
          departmentId: editing.departmentId,
          parentId: editing.parentId,
        })
      } else {
        result = await updateCategoryAction({
          ...fields,
          id: editing.category.id,
          isActive: form.get("isActive") === "on",
          // Refused if someone saved this category since the page loaded.
          expectedVersion: editing.category.version,
        })
        const parentId = text("parentId") || null
        if (result.ok && parentId !== editing.category.parentId) {
          result = await moveCategoryAction({
            id: editing.category.id,
            parentId,
          })
        }
      }
      if (result.ok) {
        toast.success("Category saved")
        onClose()
      } else {
        setErrors(result.fieldErrors ?? {})
        toast.error(result.message)
      }
    })
  }

  // A category can't move inside itself or its own descendants.
  const descendants = (id: string): Set<string> => {
    const out = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const c of categories) {
        if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
          out.add(c.id)
          grew = true
        }
      }
    }
    return out
  }
  const blocked = current ? descendants(current.id) : new Set<string>()

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-paper sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {current ? `Edit ${current.name}` : "New category"}
          </DialogTitle>
        </DialogHeader>
        {editing && (
          <form
            key={current?.id ?? "new"}
            onSubmit={submit}
            className="flex flex-col gap-3 text-sm"
          >
            <label className="flex flex-col gap-1">
              Name
              <input
                name="name"
                required
                defaultValue={current?.name}
                onChange={(e) => !current && setSlug(slugify(e.target.value))}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              URL slug
              <input
                name="slug"
                required
                defaultValue={current?.slug ?? slug}
                key={current ? "fixed" : slug}
                className={input}
              />
              {errors.slug && (
                <span className="text-xs text-destructive">
                  {errors.slug[0]}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              Description
              <textarea
                name="description"
                defaultValue={current?.description ?? ""}
                rows={2}
                className="rounded-sm border border-input bg-card px-2 py-1"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                Default HSN code
                <input
                  name="hsn"
                  inputMode="numeric"
                  defaultValue={current?.defaultHsnCode ?? ""}
                  className={input}
                />
              </label>
              <label className="flex flex-col gap-1">
                Size chart
                <select
                  name="sizeChartId"
                  defaultValue={current?.sizeChartId ?? ""}
                  className={input}
                >
                  <option value="">None</option>
                  {sizeCharts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="exchangeAllowed"
                defaultChecked={current?.exchangeAllowed ?? true}
              />
              Customers can exchange items in this category (turn off for
              innerwear)
            </label>
            {current && (
              <>
                <label className="flex flex-col gap-1">
                  Inside
                  <select
                    name="parentId"
                    defaultValue={current.parentId ?? ""}
                    className={input}
                  >
                    <option value="">(top level)</option>
                    {categories
                      .filter(
                        (c) =>
                          c.departmentId === current.departmentId &&
                          !blocked.has(c.id),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {"— ".repeat(c.depth)}
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={current.isActive}
                  />{" "}
                  Visible in the store
                </label>
              </>
            )}
            <Button type="submit" disabled={pending} className="rounded-sm">
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

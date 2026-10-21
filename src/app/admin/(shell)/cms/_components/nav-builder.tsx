"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import type { EditorState, MenuKey, NavItem } from "@/features/cms"
import {
  navigationDataSchema,
  type NavigationData,
} from "@/features/cms/schemas"
import { cn } from "@/lib/utils"

import { useLabels } from "./labels"
import { MediaField } from "./pickers"
import { useAutosave, type EditorContext } from "./use-autosave"

type Errors = Record<string, string>
type Link = NavItem["link"]

const field =
  "h-9 w-full rounded-sm border bg-card px-3 text-sm aria-invalid:border-destructive"

/** Depth each menu supports: header = items → columns → links. */
const DEPTH: Record<MenuKey, number> = {
  header: 3,
  mobile: 2,
  footer: 2,
  social: 1,
}

const LEVEL_NOUN = ["Item", "Column", "Link"] as const

function validate(data: NavigationData): Errors {
  const parsed = navigationDataSchema.safeParse(data)
  if (parsed.success) return {}
  const errors: Errors = {}
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".")
    errors[path] ??= issue.message.startsWith("Invalid")
      ? "Fill this in."
      : issue.message
  }
  return errors
}

const newItem = (): NavItem => ({
  id: `nav-${crypto.randomUUID().slice(0, 8)}`,
  label: "New link",
  link: { type: "url", href: "/shop" },
})

/** Menu editor (doc/06 Phase 6b): labels, links, badges and promo images. */
export function NavBuilder({
  menuKey,
  state,
  context,
}: {
  menuKey: MenuKey
  state: EditorState<NavigationData>
  context: EditorContext
}) {
  const countErrors = useCallback(
    (data: NavigationData) => Object.keys(validate(data)).length,
    [],
  )
  const { data, update } = useAutosave<NavigationData>({
    target: { type: "navigation", key: menuKey },
    state,
    errorCount: countErrors,
    context,
  })
  const errors = useMemo(() => validate(data), [data])
  const count = Object.keys(errors).length

  return (
    <div className="flex flex-col gap-3">
      {count > 0 && !context.readOnly && (
        <p
          role="alert"
          className="rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          {count} field{count === 1 ? " needs" : "s need"} attention before this
          can be saved.
        </p>
      )}
      <fieldset disabled={context.readOnly} className="flex flex-col gap-3">
        <ItemList
          items={data.items}
          level={0}
          maxDepth={DEPTH[menuKey]}
          menuKey={menuKey}
          path="items"
          errors={errors}
          max={12}
          onChange={(items) => update({ ...data, items })}
        />
      </fieldset>
    </div>
  )
}

function ItemList({
  items,
  level,
  maxDepth,
  menuKey,
  path,
  errors,
  max,
  onChange,
}: {
  items: NavItem[]
  level: number
  maxDepth: number
  menuKey: MenuKey
  path: string
  errors: Errors
  max: number
  onChange: (items: NavItem[]) => void
}) {
  const noun = LEVEL_NOUN[level] ?? "Link"
  const move = (index: number, by: number) => {
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    onChange(next)
  }
  return (
    <div className={cn("flex flex-col gap-2", level > 0 && "border-l pl-3")}>
      {items.map((item, index) => (
        <ItemCard
          key={item.id}
          item={item}
          index={index}
          count={items.length}
          level={level}
          maxDepth={maxDepth}
          menuKey={menuKey}
          path={`${path}.${index}`}
          errors={errors}
          noun={noun}
          onMove={(by) => move(index, by)}
          onDelete={() => onChange(items.filter((_, i) => i !== index))}
          onChange={(next) =>
            onChange(items.map((it, i) => (i === index ? next : it)))
          }
        />
      ))}
      {items.length < max && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start rounded-sm"
          onClick={() => onChange([...items, newItem()])}
        >
          <PlusIcon className="size-4" aria-hidden /> Add {noun.toLowerCase()}
        </Button>
      )}
    </div>
  )
}

function ItemCard({
  item,
  index,
  count,
  level,
  maxDepth,
  menuKey,
  path,
  errors,
  noun,
  onMove,
  onDelete,
  onChange,
}: {
  item: NavItem
  index: number
  count: number
  level: number
  maxDepth: number
  menuKey: MenuKey
  path: string
  errors: Errors
  noun: string
  onMove: (by: number) => void
  onDelete: () => void
  onChange: (item: NavItem) => void
}) {
  const [open, setOpen] = useState(false)
  const problems = Object.keys(errors).filter((key) =>
    key.startsWith(`${path}.`),
  ).length
  const canNest = level + 1 < maxDepth
  return (
    <div
      className={cn(
        "rounded-sm border bg-card",
        problems > 0 && "border-destructive/60",
      )}
      data-testid="nav-item"
    >
      <div className="flex items-center gap-2 p-2 text-sm">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDownIcon
            className={cn("size-4 shrink-0", open && "rotate-180")}
            aria-hidden
          />
          <span className="truncate font-medium">{item.label || noun}</span>
          {item.badge && (
            <span className="bg-mustard px-1 text-[0.625rem] font-bold uppercase">
              {item.badge}
            </span>
          )}
          {(item.children?.length ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">
              {item.children!.length} inside
            </span>
          )}
          {problems > 0 && (
            <span className="ml-auto rounded-sm bg-destructive/10 px-1.5 text-xs text-destructive">
              {problems} to fix
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label={`Move ${item.label} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="rounded-sm p-1 hover:bg-secondary disabled:opacity-30"
        >
          <ArrowUpIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Move ${item.label} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          className="rounded-sm p-1 hover:bg-secondary disabled:opacity-30"
        >
          <ArrowDownIcon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Delete ${item.label}`}
          onClick={() => {
            if (window.confirm(`Delete "${item.label}" and everything in it?`))
              onDelete()
          }}
          className="rounded-sm p-1 hover:bg-secondary"
        >
          <Trash2Icon className="size-4" aria-hidden />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t p-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Label</span>
              <input
                value={item.label}
                maxLength={40}
                aria-invalid={errors[`${path}.label`] ? true : undefined}
                onChange={(event) =>
                  onChange({ ...item, label: event.target.value })
                }
                className={field}
              />
              {errors[`${path}.label`] && (
                <span className="text-xs text-destructive">
                  {errors[`${path}.label`]}
                </span>
              )}
            </label>
            {menuKey !== "social" && (
              <label className="flex flex-col gap-1.5">
                <span className="font-medium">Badge (optional)</span>
                <input
                  value={item.badge ?? ""}
                  maxLength={12}
                  placeholder="NEW"
                  onChange={(event) =>
                    onChange({
                      ...item,
                      badge: event.target.value.trim()
                        ? event.target.value
                        : undefined,
                    })
                  }
                  className={field}
                />
              </label>
            )}
          </div>
          <LinkEditor
            link={item.link}
            path={`${path}.link`}
            errors={errors}
            onChange={(link) => onChange({ ...item, link })}
          />
          {menuKey === "header" && level === 0 && (
            <MediaField
              label="Promo image in the menu"
              optional
              value={item.promoMediaId}
              onChange={(promoMediaId) => onChange({ ...item, promoMediaId })}
            />
          )}
          {canNest && (
            <div className="flex flex-col gap-2">
              <span className="font-medium">
                {LEVEL_NOUN[level + 1]}s inside
              </span>
              <ItemList
                items={item.children ?? []}
                level={level + 1}
                maxDepth={maxDepth}
                menuKey={menuKey}
                path={`${path}.children`}
                errors={errors}
                max={30}
                onChange={(children) =>
                  onChange({
                    ...item,
                    children: children.length > 0 ? children : undefined,
                  })
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const LINK_TYPES: { value: Link["type"]; label: string }[] = [
  { value: "category", label: "Category" },
  { value: "collection", label: "Collection" },
  { value: "page", label: "Page" },
  { value: "url", label: "Web address" },
]

function LinkEditor({
  link,
  path,
  errors,
  onChange,
}: {
  link: Link
  path: string
  errors: Errors
  onChange: (link: Link) => void
}) {
  const labels = useLabels()
  const error = Object.entries(errors).find(([key]) =>
    key.startsWith(path),
  )?.[1]
  return (
    <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">Goes to</span>
        <select
          value={link.type}
          onChange={(event) => {
            const type = event.target.value as Link["type"]
            onChange(
              type === "category"
                ? { type, categoryId: labels.categories[0]?.id ?? "" }
                : type === "collection"
                  ? { type, collectionId: labels.collections[0]?.id ?? "" }
                  : type === "page"
                    ? { type, slug: labels.pages[0]?.id ?? "" }
                    : type === "product"
                      ? link
                      : { type: "url", href: "/" },
            )
          }}
          className={field}
        >
          {LINK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
          {link.type === "product" && <option value="product">Product</option>}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">
          {link.type === "url" ? "Address" : "Choose"}
        </span>
        {link.type === "category" && (
          <select
            value={link.categoryId}
            onChange={(e) =>
              onChange({ type: "category", categoryId: e.target.value })
            }
            className={field}
          >
            {labels.categories.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {link.type === "collection" && (
          <select
            value={link.collectionId}
            onChange={(e) =>
              onChange({ type: "collection", collectionId: e.target.value })
            }
            className={field}
          >
            {labels.collections.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {link.type === "page" && (
          <select
            value={link.slug}
            onChange={(e) => onChange({ type: "page", slug: e.target.value })}
            className={field}
          >
            {labels.pages.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {link.type === "url" && (
          <input
            value={link.href}
            maxLength={500}
            aria-invalid={error ? true : undefined}
            placeholder="/shop or https://…"
            onChange={(e) => onChange({ type: "url", href: e.target.value })}
            className={field}
          />
        )}
        {link.type === "product" && (
          <span className="text-muted-foreground">
            {labels.products.get(link.productId) ?? "A product"}
          </span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </label>
    </div>
  )
}

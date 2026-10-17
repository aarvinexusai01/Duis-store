"use client"

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { Block, BlockType, PageEditorState } from "@/features/cms"
import { autosavePageAction } from "@/features/cms/admin-actions"
import { pageDataSchema, type PageData } from "@/features/cms/schemas"
import { cn } from "@/lib/utils"

import {
  BLOCK_LABELS,
  BlockForm,
  newBlock,
  type FieldErrors,
} from "./block-forms"
import { MediaField } from "./pickers"

export type SaveState =
  | { kind: "saved"; at: Date | null }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "invalid"; count: number }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string }

type Base = { revisionId: string; updatedAt: string } | null

/** Validation errors grouped by section id (and "seo"), keyed by field path. */
function validate(data: PageData): Record<string, FieldErrors> {
  const parsed = pageDataSchema.safeParse(data)
  if (parsed.success) return {}
  const grouped: Record<string, FieldErrors> = {}
  for (const issue of parsed.error.issues) {
    const [root, index, ...rest] = issue.path
    let key = "page"
    let path = rest.join(".")
    if (root === "sections" && typeof index === "number") {
      key = data.sections[index]?.id ?? "page"
    } else if (root === "seo") {
      key = "seo"
      path = [index, ...rest].join(".")
    }
    const group = (grouped[key] ??= {})
    group[path || "_"] ??= issue.message.startsWith("Invalid")
      ? "Fill this in."
      : issue.message
  }
  return grouped
}

function summary(block: Block): string {
  if ("heading" in block && block.heading) return block.heading
  if (block.type === "announcement") return block.text
  if (block.type === "hero_banner" || block.type === "promo_slider")
    return `${block.slides.length} slide${block.slides.length === 1 ? "" : "s"}`
  if (block.type === "promo_banner_grid")
    return `${block.banners.length} banner${block.banners.length === 1 ? "" : "s"}`
  return ""
}

/**
 * The page builder (doc/06 Phase 6a): sections in order, a form for each,
 * and autosave of the working draft about two seconds after a change.
 */
export function PageBuilder({
  state,
  readOnly,
  onSaved,
  onSaveState,
}: {
  state: PageEditorState
  readOnly: boolean
  onSaved: (base: { revisionId: string; updatedAt: string }) => void
  onSaveState: (save: SaveState) => void
}) {
  const [data, setData] = useState<PageData>(state.data)
  const [open, setOpen] = useState<string | null>(null)
  const base = useRef<Base>(
    state.draft
      ? { revisionId: state.draft.revisionId, updatedAt: state.draft.updatedAt }
      : null,
  )
  const latest = useRef(data)
  const saving = useRef(false)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const errors = useMemo(() => validate(data), [data])
  const errorCount = Object.values(errors).reduce(
    (n, group) => n + Object.keys(group).length,
    0,
  )

  // Saves until nothing new is pending; edits made during a save go next.
  const save = useCallback(async () => {
    if (saving.current) return
    saving.current = true
    try {
      while (dirty.current) {
        const snapshot = latest.current
        if (!pageDataSchema.safeParse(snapshot).success) return
        dirty.current = false
        onSaveState({ kind: "saving" })
        const result = await autosavePageAction({
          pageId: state.page.id,
          data: snapshot,
          base: base.current,
        })
        if (!result.ok) {
          dirty.current = true
          onSaveState(
            result.code === "CONFLICT"
              ? { kind: "conflict", message: result.message }
              : { kind: "error", message: result.message },
          )
          return
        }
        base.current = {
          revisionId: result.revisionId,
          updatedAt: result.updatedAt,
        }
        onSaved(base.current)
      }
      onSaveState({ kind: "saved", at: new Date() })
    } finally {
      saving.current = false
    }
  }, [onSaveState, onSaved, state.page.id])

  // Debounced autosave after every change.
  const update = (next: PageData) => {
    if (readOnly) return
    setData(next)
    latest.current = next
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    const invalid = validate(next)
    const count = Object.values(invalid).reduce(
      (n, group) => n + Object.keys(group).length,
      0,
    )
    if (count > 0) {
      onSaveState({ kind: "invalid", count })
      return
    }
    onSaveState({ kind: "pending" })
    timer.current = setTimeout(() => void save(), 1_500)
  }

  // Save on leaving the page if something is still pending.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const sections = data.sections
  const setSections = (next: Block[]) => update({ ...data, sections: next })
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = sections.findIndex((s) => s.id === active.id)
    const to = sections.findIndex((s) => s.id === over.id)
    setSections(arrayMove(sections, from, to))
  }
  const add = (type: BlockType) => {
    const block = newBlock(type)
    setSections([...sections, block])
    setOpen(block.id)
  }

  return (
    <div className="flex flex-col gap-4">
      {errorCount > 0 && !readOnly && (
        <p
          role="alert"
          className="rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          {errorCount} field{errorCount === 1 ? " needs" : "s need"} attention
          before this can be saved.
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="flex flex-col gap-2" aria-label="Page sections">
            {sections.map((block, index) => (
              <SectionCard
                key={block.id}
                block={block}
                index={index}
                count={sections.length}
                expanded={open === block.id}
                readOnly={readOnly}
                errors={errors[block.id] ?? {}}
                onToggle={() => setOpen(open === block.id ? null : block.id)}
                onChange={(next) =>
                  setSections(sections.map((s, i) => (i === index ? next : s)))
                }
                onMove={(by) =>
                  setSections(arrayMove(sections, index, index + by))
                }
                onDuplicate={() => {
                  const copy = {
                    ...structuredClone(block),
                    id: `${block.type}-${crypto.randomUUID().slice(0, 8)}`,
                  }
                  setSections([
                    ...sections.slice(0, index + 1),
                    copy,
                    ...sections.slice(index + 1),
                  ])
                  setOpen(copy.id)
                }}
                onDelete={() => {
                  if (
                    window.confirm(
                      `Delete the ${BLOCK_LABELS[block.type].toLowerCase()} section?`,
                    )
                  )
                    setSections(sections.filter((_, i) => i !== index))
                }}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {sections.length === 0 && (
        <p className="rounded-sm border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections yet. Add the first one below.
        </p>
      )}
      {!readOnly && (
        <label className="flex items-center gap-2 text-sm">
          <PlusIcon className="size-4" aria-hidden />
          <span className="sr-only">Add a section</span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) add(event.target.value as BlockType)
            }}
            className="h-9 rounded-sm border bg-card px-2"
            aria-label="Add a section"
            disabled={sections.length >= 40}
          >
            <option value="">Add a section…</option>
            {(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => (
              <option key={type} value={type}>
                {BLOCK_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      )}
      <SeoPanel
        seo={data.seo}
        readOnly={readOnly}
        errors={errors.seo ?? {}}
        onChange={(seo) => update({ ...data, seo })}
      />
    </div>
  )
}

function SectionCard({
  block,
  index,
  count,
  expanded,
  readOnly,
  errors,
  onToggle,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  block: Block
  index: number
  count: number
  expanded: boolean
  readOnly: boolean
  errors: FieldErrors
  onToggle: () => void
  onChange: (block: Block) => void
  onMove: (by: number) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id, disabled: readOnly })
  const problems = Object.keys(errors).length
  const label = BLOCK_LABELS[block.type]
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-sm border bg-card",
        isDragging && "z-10 shadow-lg",
        !block.enabled && "opacity-70",
        problems > 0 && "border-destructive/60",
      )}
      data-testid="cms-section"
    >
      <div className="flex items-center gap-2 p-2">
        {!readOnly && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${label} section (position ${index + 1} of ${count})`}
            className="cursor-grab touch-none rounded-sm p-1 text-muted-foreground hover:bg-secondary active:cursor-grabbing"
          >
            <GripVerticalIcon className="size-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
          <span className="font-medium">{label}</span>
          <span className="truncate text-muted-foreground">
            {summary(block)}
          </span>
          {problems > 0 && (
            <span className="ml-auto shrink-0 rounded-sm bg-destructive/10 px-1.5 text-xs font-medium text-destructive">
              {problems} to fix
            </span>
          )}
          {!block.enabled && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              Hidden
            </span>
          )}
        </button>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={`Move ${label} up`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="rounded-sm p-1 hover:bg-secondary disabled:opacity-30"
            >
              <ArrowUpIcon className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Move ${label} down`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
              className="rounded-sm p-1 hover:bg-secondary disabled:opacity-30"
            >
              <ArrowDownIcon className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="flex flex-col gap-4 border-t p-3">
          <fieldset disabled={readOnly} className="flex flex-col gap-4">
            <BlockForm block={block} onChange={onChange} errors={errors} />
          </fieldset>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
              <label className="flex items-center gap-2">
                <Switch
                  checked={block.enabled}
                  onCheckedChange={(enabled) => onChange({ ...block, enabled })}
                />
                Shown on the page
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-sm"
                onClick={onDuplicate}
              >
                <CopyIcon className="size-4" aria-hidden /> Duplicate
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-sm text-destructive"
                onClick={onDelete}
              >
                <Trash2Icon className="size-4" aria-hidden /> Delete
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function SeoPanel({
  seo,
  readOnly,
  errors,
  onChange,
}: {
  seo: PageData["seo"]
  readOnly: boolean
  errors: FieldErrors
  onChange: (seo: PageData["seo"]) => void
}) {
  const input = "h-9 w-full rounded-sm border bg-card px-3 text-sm"
  return (
    <details className="rounded-sm border bg-card">
      <summary className="cursor-pointer p-3 text-sm font-medium">
        Search and sharing
      </summary>
      <fieldset disabled={readOnly} className="grid gap-3 border-t p-3 text-sm">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Page title in search results</span>
          <input
            value={seo.title ?? ""}
            maxLength={70}
            onChange={(e) =>
              onChange({ ...seo, title: e.target.value || undefined })
            }
            className={input}
          />
          <span className="text-xs text-muted-foreground">
            {seo.title?.length ?? 0}/70. Leave empty to use the page name.
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Description</span>
          <textarea
            value={seo.description ?? ""}
            maxLength={170}
            rows={2}
            onChange={(e) =>
              onChange({ ...seo, description: e.target.value || undefined })
            }
            className="w-full rounded-sm border bg-card p-2"
          />
          <span className="text-xs text-muted-foreground">
            {seo.description?.length ?? 0}/170
          </span>
        </label>
        <MediaField
          label="Image when shared"
          optional
          value={seo.ogMediaId}
          error={errors.ogMediaId}
          onChange={(ogMediaId) => onChange({ ...seo, ogMediaId })}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={seo.noindex ?? false}
            onChange={(e) =>
              onChange({ ...seo, noindex: e.target.checked || undefined })
            }
          />
          Hide from search engines
        </label>
      </fieldset>
    </details>
  )
}

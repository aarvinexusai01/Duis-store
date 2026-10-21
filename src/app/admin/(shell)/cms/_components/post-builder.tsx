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
  GripVerticalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useCallback, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import { RichTextEditor } from "@/components/admin/rich-text-editor"
import type { EditorState } from "@/features/cms"
import { createTagAction } from "@/features/cms/admin-actions"
import {
  blogPostDataSchema,
  instagramUrl,
  youtubeId,
  type BlogPostData,
  type PostBlock,
  type PostBlockType,
} from "@/features/cms/journal-schemas"
import { paragraphs } from "@/lib/rich-text"
import { slugify } from "@/lib/slug"
import { cn } from "@/lib/utils"

import type { Option } from "./labels"
import { MediaField, ProductListField } from "./pickers"
import { useAutosave, type EditorContext } from "./use-autosave"

type Errors = Record<string, string>

const input =
  "h-9 w-full rounded-sm border bg-card px-3 text-sm aria-invalid:border-destructive"

const BLOCK_LABELS: Record<PostBlockType, string> = {
  text: "Text",
  image: "Image",
  products: "Shop the post",
  youtube: "YouTube video",
  instagram: "Instagram post",
}

function newBlock(type: PostBlockType): PostBlock {
  const id = `${type}-${crypto.randomUUID().slice(0, 8)}`
  switch (type) {
    case "text":
      return { id, type, content: paragraphs("") }
    case "image":
      return { id, type, mediaId: "" }
    case "products":
      return { id, type, productIds: [] }
    case "youtube":
      return { id, type, videoId: "" }
    case "instagram":
      return { id, type, url: "" }
  }
}

/** Errors by block id ("_" for post fields), keyed by field. */
function validate(data: BlogPostData): Record<string, Errors> {
  const parsed = blogPostDataSchema.safeParse(data)
  if (parsed.success) return {}
  const grouped: Record<string, Errors> = {}
  for (const issue of parsed.error.issues) {
    const [root, index, ...rest] = issue.path
    let key = "_"
    let path = String(root)
    if (root === "body" && typeof index === "number") {
      key = data.body[index]?.id ?? "_"
      path = rest.join(".") || "_"
    } else if (root === "seo") {
      path = `seo.${String(index)}`
    }
    const message =
      root === "authorId"
        ? "Choose an author."
        : issue.message.startsWith("Invalid")
          ? "Fill this in."
          : issue.message
    ;(grouped[key] ??= {})[path] ??= message
  }
  return grouped
}

const count = (groups: Record<string, Errors>) =>
  Object.values(groups).reduce((n, g) => n + Object.keys(g).length, 0)

/** The post editor (doc/06 Phase 6c). */
export function PostBuilder({
  postId,
  state,
  context,
  authors,
  categories,
  tags: initialTags,
}: {
  postId: string
  state: EditorState<BlogPostData>
  context: EditorContext
  authors: Option[]
  categories: Option[]
  tags: Option[]
}) {
  const countErrors = useCallback(
    (data: BlogPostData) => count(validate(data)),
    [],
  )
  const { data, update } = useAutosave<BlogPostData>({
    target: { type: "blog_post", id: postId },
    state,
    errorCount: countErrors,
    context,
  })
  const [open, setOpen] = useState<string | null>(null)
  const [tags, setTags] = useState(initialTags)
  const errors = useMemo(() => validate(data), [data])
  const total = count(errors)
  const fieldErrors = errors._ ?? {}
  const set = (patch: Partial<BlogPostData>) => update({ ...data, ...patch })
  const setBody = (body: PostBlock[]) => set({ body })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = data.body.findIndex((b) => b.id === active.id)
    const to = data.body.findIndex((b) => b.id === over.id)
    setBody(arrayMove(data.body, from, to))
  }

  return (
    <div className="flex flex-col gap-4">
      {total > 0 && !context.readOnly && (
        <p
          role="alert"
          className="rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          {total} field{total === 1 ? " needs" : "s need"} attention before this
          can be saved.
        </p>
      )}
      <fieldset
        disabled={context.readOnly}
        className="flex flex-col gap-3 rounded-sm border bg-card p-4 text-sm"
      >
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Title</span>
          <input
            value={data.title}
            maxLength={140}
            aria-invalid={fieldErrors.title ? true : undefined}
            onChange={(e) => set({ title: e.target.value })}
            className={cn(input, "h-11 text-lg font-semibold")}
          />
          {fieldErrors.title && (
            <span className="text-xs text-destructive">
              {fieldErrors.title}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">
            Excerpt (shown in lists and feeds)
          </span>
          <textarea
            value={data.excerpt ?? ""}
            maxLength={300}
            rows={2}
            onChange={(e) => set({ excerpt: e.target.value || undefined })}
            className="rounded-sm border bg-card p-2"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Author</span>
            <select
              value={data.authorId}
              aria-invalid={fieldErrors.authorId ? true : undefined}
              onChange={(e) => set({ authorId: e.target.value })}
              className={input}
            >
              <option value="">Choose…</option>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            {fieldErrors.authorId && (
              <span className="text-xs text-destructive">
                {fieldErrors.authorId}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Category (optional)</span>
            <select
              value={data.categoryId ?? ""}
              onChange={(e) => set({ categoryId: e.target.value || undefined })}
              className={input}
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <TagPicker
          options={tags}
          value={data.tagIds}
          onAdd={(tag) => setTags((current) => [...current, tag])}
          onChange={(tagIds) => set({ tagIds })}
        />
        <MediaField
          label="Cover image"
          optional
          value={data.coverMediaId}
          onChange={(coverMediaId) => set({ coverMediaId })}
        />
      </fieldset>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={data.body.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="flex flex-col gap-2" aria-label="Story blocks">
            {data.body.map((block, index) => (
              <BlockCard
                key={block.id}
                block={block}
                index={index}
                count={data.body.length}
                expanded={open === block.id}
                readOnly={context.readOnly}
                errors={errors[block.id] ?? {}}
                onToggle={() => setOpen(open === block.id ? null : block.id)}
                onChange={(next) =>
                  setBody(data.body.map((b, i) => (i === index ? next : b)))
                }
                onMove={(by) =>
                  setBody(arrayMove(data.body, index, index + by))
                }
                onDelete={() => {
                  if (
                    window.confirm(
                      `Delete this ${BLOCK_LABELS[block.type].toLowerCase()} block?`,
                    )
                  )
                    setBody(data.body.filter((_, i) => i !== index))
                }}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {data.body.length === 0 && (
        <p className="rounded-sm border border-dashed p-6 text-center text-sm text-muted-foreground">
          The story is empty. Add a text block to start writing.
        </p>
      )}
      {!context.readOnly && (
        <select
          value=""
          aria-label="Add a block"
          disabled={data.body.length >= 60}
          onChange={(e) => {
            if (!e.target.value) return
            const block = newBlock(e.target.value as PostBlockType)
            setBody([...data.body, block])
            setOpen(block.id)
          }}
          className="h-9 self-start rounded-sm border bg-card px-2 text-sm"
        >
          <option value="">Add a block…</option>
          {(Object.keys(BLOCK_LABELS) as PostBlockType[]).map((type) => (
            <option key={type} value={type}>
              {BLOCK_LABELS[type]}
            </option>
          ))}
        </select>
      )}

      <details className="rounded-sm border bg-card">
        <summary className="cursor-pointer p-3 text-sm font-medium">
          Search and sharing
        </summary>
        <fieldset
          disabled={context.readOnly}
          className="grid gap-3 border-t p-3 text-sm"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Title in search results</span>
            <input
              value={data.seo.title ?? ""}
              maxLength={70}
              onChange={(e) =>
                set({
                  seo: { ...data.seo, title: e.target.value || undefined },
                })
              }
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Description</span>
            <textarea
              value={data.seo.description ?? ""}
              maxLength={170}
              rows={2}
              onChange={(e) =>
                set({
                  seo: {
                    ...data.seo,
                    description: e.target.value || undefined,
                  },
                })
              }
              className="rounded-sm border bg-card p-2"
            />
          </label>
          <MediaField
            label="Image when shared (defaults to the cover)"
            optional
            value={data.seo.ogMediaId}
            onChange={(ogMediaId) => set({ seo: { ...data.seo, ogMediaId } })}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.seo.noindex ?? false}
              onChange={(e) =>
                set({
                  seo: { ...data.seo, noindex: e.target.checked || undefined },
                })
              }
            />
            Hide from search engines and the RSS feed
          </label>
        </fieldset>
      </details>
    </div>
  )
}

function TagPicker({
  options,
  value,
  onAdd,
  onChange,
}: {
  options: Option[]
  value: string[]
  onAdd: (tag: Option) => void
  onChange: (ids: string[]) => void
}) {
  const [text, setText] = useState("")
  const [pending, startTransition] = useTransition()
  const name = (id: string) => options.find((o) => o.id === id)?.label ?? "Tag"
  const add = () => {
    const label = text.trim()
    if (!label) return
    const existing = options.find(
      (o) => o.label.toLowerCase() === label.toLowerCase(),
    )
    if (existing) {
      if (!value.includes(existing.id)) onChange([...value, existing.id])
      setText("")
      return
    }
    startTransition(async () => {
      const result = await createTagAction({
        name: label,
        slug: slugify(label),
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      onAdd({ id: result.id, label: result.name })
      onChange([...value, result.id])
      setText("")
    })
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">Tags</span>
      <ul className="flex flex-wrap gap-1">
        {value.map((id) => (
          <li
            key={id}
            className="flex items-center gap-1 rounded-sm border bg-background px-2 py-0.5"
          >
            #{name(id)}
            <button
              type="button"
              aria-label={`Remove tag ${name(id)}`}
              onClick={() => onChange(value.filter((v) => v !== id))}
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {value.length < 10 && (
        <div className="flex gap-2">
          <input
            value={text}
            list="journal-tags"
            maxLength={40}
            placeholder="Add a tag"
            aria-label="Add a tag"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            className={cn(input, "max-w-xs")}
          />
          <button
            type="button"
            disabled={pending || !text.trim()}
            onClick={add}
            className="rounded-sm border px-3 text-sm disabled:opacity-40"
          >
            Add
          </button>
          <datalist id="journal-tags">
            {options.map((o) => (
              <option key={o.id} value={o.label} />
            ))}
          </datalist>
        </div>
      )}
    </div>
  )
}

function summary(block: PostBlock): string {
  switch (block.type) {
    case "text":
      return (
        block.content.content
          .flatMap((b) =>
            "content" in b && Array.isArray(b.content)
              ? b.content.map((c) => ("text" in c ? c.text : ""))
              : [],
          )
          .join(" ")
          .slice(0, 60) || "Empty"
      )
    case "products":
      return `${block.productIds.length} product${block.productIds.length === 1 ? "" : "s"}`
    case "image":
      return block.caption ?? ""
    case "youtube":
      return block.title ?? block.videoId
    case "instagram":
      return block.url.replace("https://www.instagram.com", "")
  }
}

function BlockCard({
  block,
  index,
  count: total,
  expanded,
  readOnly,
  errors,
  onToggle,
  onChange,
  onMove,
  onDelete,
}: {
  block: PostBlock
  index: number
  count: number
  expanded: boolean
  readOnly: boolean
  errors: Errors
  onToggle: () => void
  onChange: (block: PostBlock) => void
  onMove: (by: number) => void
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
  const label = BLOCK_LABELS[block.type]
  const problems = Object.keys(errors).length
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-sm border bg-card",
        isDragging && "z-10 shadow-lg",
        problems > 0 && "border-destructive/60",
      )}
      data-testid="post-block"
    >
      <div className="flex items-center gap-2 p-2 text-sm">
        {!readOnly && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${label} block (position ${index + 1} of ${total})`}
            className="cursor-grab touch-none rounded-sm p-1 text-muted-foreground hover:bg-secondary"
          >
            <GripVerticalIcon className="size-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDownIcon
            className={cn("size-4 shrink-0", expanded && "rotate-180")}
            aria-hidden
          />
          <span className="font-medium">{label}</span>
          <span className="truncate text-muted-foreground">
            {summary(block)}
          </span>
          {problems > 0 && (
            <span className="ml-auto rounded-sm bg-destructive/10 px-1.5 text-xs text-destructive">
              {problems} to fix
            </span>
          )}
        </button>
        {!readOnly && (
          <>
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
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              className="rounded-sm p-1 hover:bg-secondary disabled:opacity-30"
            >
              <ArrowDownIcon className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Delete ${label} block`}
              onClick={onDelete}
              className="rounded-sm p-1 hover:bg-secondary"
            >
              <Trash2Icon className="size-4" aria-hidden />
            </button>
          </>
        )}
      </div>
      {expanded && (
        <fieldset
          disabled={readOnly}
          className="flex flex-col gap-3 border-t p-3 text-sm"
        >
          <BlockFields block={block} errors={errors} onChange={onChange} />
        </fieldset>
      )}
    </li>
  )
}

function BlockFields({
  block,
  errors,
  onChange,
}: {
  block: PostBlock
  errors: Errors
  onChange: (block: PostBlock) => void
}) {
  const [link, setLink] = useState(
    block.type === "youtube"
      ? block.videoId
      : block.type === "instagram"
        ? block.url
        : "",
  )
  switch (block.type) {
    case "text":
      return (
        <RichTextEditor
          label="Text"
          value={block.content}
          onChange={(doc) =>
            onChange({ ...block, content: doc ?? paragraphs("") })
          }
        />
      )
    case "image":
      return (
        <>
          <MediaField
            label="Image"
            value={block.mediaId || undefined}
            error={errors.mediaId}
            onChange={(mediaId) =>
              onChange({ ...block, mediaId: mediaId ?? "" })
            }
          />
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Caption (optional)</span>
            <input
              value={block.caption ?? ""}
              maxLength={200}
              onChange={(e) =>
                onChange({ ...block, caption: e.target.value || undefined })
              }
              className={input}
            />
          </label>
        </>
      )
    case "products":
      return (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Heading (optional)</span>
            <input
              value={block.heading ?? ""}
              maxLength={80}
              placeholder="Shop the post"
              onChange={(e) =>
                onChange({ ...block, heading: e.target.value || undefined })
              }
              className={input}
            />
          </label>
          <ProductListField
            label="Products"
            value={block.productIds}
            error={errors.productIds}
            onChange={(productIds) =>
              onChange({ ...block, productIds: productIds.slice(0, 8) })
            }
          />
        </>
      )
    case "youtube":
      return (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">YouTube link</span>
            <input
              value={link}
              placeholder="https://www.youtube.com/watch?v=…"
              aria-invalid={errors.videoId ? true : undefined}
              onChange={(e) => {
                setLink(e.target.value)
                onChange({ ...block, videoId: youtubeId(e.target.value) ?? "" })
              }}
              className={input}
            />
            <span
              className={
                errors.videoId
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {errors.videoId ??
                "Nothing loads from YouTube until a reader presses play."}
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Title (optional)</span>
            <input
              value={block.title ?? ""}
              maxLength={120}
              onChange={(e) =>
                onChange({ ...block, title: e.target.value || undefined })
              }
              className={input}
            />
          </label>
        </>
      )
    case "instagram":
      return (
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Instagram post or reel link</span>
          <input
            value={link}
            placeholder="https://www.instagram.com/p/…"
            aria-invalid={errors.url ? true : undefined}
            onChange={(e) => {
              setLink(e.target.value)
              onChange({ ...block, url: instagramUrl(e.target.value) ?? "" })
            }}
            className={input}
          />
          <span
            className={
              errors.url
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {errors.url ??
              "Shows on the site only for readers who allow marketing cookies; others get a link."}
          </span>
        </label>
      )
  }
}

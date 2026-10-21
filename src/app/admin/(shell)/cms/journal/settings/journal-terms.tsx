"use client"

import { useState, useTransition, type ReactNode } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { JournalTaxonomy } from "@/features/cms"
import {
  deleteTermAction,
  saveAuthorAction,
  saveCategoryAction,
} from "@/features/cms/admin-actions"
import { slugify } from "@/lib/slug"

import { LabelsProvider } from "../../_components/labels"
import { MediaField } from "../../_components/pickers"

const input = "h-9 w-full rounded-sm border bg-background px-3 text-sm"

type Author = JournalTaxonomy["authors"][number]
type Category = JournalTaxonomy["categories"][number]

export function JournalTerms({
  taxonomy,
  canEdit,
}: {
  taxonomy: JournalTaxonomy
  canEdit: boolean
}) {
  return (
    <LabelsProvider
      initial={{
        media: taxonomy.authors.flatMap((a) =>
          a.photoMediaId && a.photoKey
            ? [{ id: a.photoMediaId, key: a.photoKey, alt: a.name }]
            : [],
        ),
        products: [],
        collections: [],
        categories: [],
        pages: [],
      }}
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Authors">
          {taxonomy.authors.map((author) => (
            <AuthorRow key={author.id} author={author} canEdit={canEdit} />
          ))}
          {canEdit && <AuthorRow author={null} canEdit />}
        </Section>
        <div className="flex flex-col gap-6">
          <Section title="Categories">
            {taxonomy.categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                canEdit={canEdit}
              />
            ))}
            {canEdit && <CategoryRow category={null} canEdit />}
          </Section>
          <Section title="Tags">
            {taxonomy.tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tags are added while writing a story.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {taxonomy.tags.map((tag) => (
                  <li
                    key={tag.id}
                    className="flex items-center gap-2 rounded-sm border bg-background px-2 py-1"
                  >
                    #{tag.name}
                    <span className="text-xs text-muted-foreground">
                      {tag.posts}
                    </span>
                    {canEdit && (
                      <DeleteButton
                        kind="tag"
                        id={tag.id}
                        name={tag.name}
                        used={tag.posts}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </LabelsProvider>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-sm border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function DeleteButton({
  kind,
  id,
  name,
  used,
}: {
  kind: "author" | "category" | "tag"
  id: string
  name: string
  used: number
}) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      title={
        used > 0 ? `Used by ${used} stor${used === 1 ? "y" : "ies"}` : undefined
      }
      onClick={() => {
        if (!window.confirm(`Delete ${name}?`)) return
        startTransition(async () => {
          const result = await deleteTermAction({ kind, id })
          if (result.ok) toast.success("Deleted")
          else toast.error(result.message)
        })
      }}
      className="text-xs text-destructive underline disabled:opacity-40"
    >
      Delete
    </button>
  )
}

function AuthorRow({
  author,
  canEdit,
}: {
  author: Author | null
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(author === null)
  const [name, setName] = useState(author?.name ?? "")
  const [slug, setSlug] = useState(author?.slug ?? "")
  const [bio, setBio] = useState(author?.bio ?? "")
  const [photo, setPhoto] = useState(author?.photoMediaId ?? undefined)
  const [pending, startTransition] = useTransition()

  if (!editing && author)
    return (
      <div className="flex items-center gap-3 border-t pt-3 text-sm first:border-t-0 first:pt-0">
        <span className="flex-1">
          <span className="font-medium">{author.name}</span>{" "}
          <span className="text-muted-foreground">
            /journal/author/{author.slug}
          </span>
          <span className="block text-xs text-muted-foreground">
            {author.posts} stor{author.posts === 1 ? "y" : "ies"}
          </span>
        </span>
        {canEdit && (
          <>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <DeleteButton
              kind="author"
              id={author.id}
              name={author.name}
              used={author.posts}
            />
          </>
        )}
      </div>
    )
  return (
    <form
      className="flex flex-col gap-2 border-t pt-3 text-sm first:border-t-0 first:pt-0"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const result = await saveAuthorAction({
            ...(author ? { id: author.id } : {}),
            name,
            slug,
            bio: bio.trim() || null,
            photoMediaId: photo ?? null,
          })
          if (result.ok) {
            toast.success(author ? "Author saved" : "Author added")
            if (author) setEditing(false)
            else {
              setName("")
              setSlug("")
              setBio("")
              setPhoto(undefined)
            }
          } else toast.error(result.fieldErrors?.slug?.[0] ?? result.message)
        })
      }}
    >
      <span className="font-medium">
        {author ? `Edit ${author.name}` : "Add an author"}
      </span>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          required
          placeholder="Name"
          aria-label="Author name"
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value)
            if (!author) setSlug(slugify(e.target.value))
          }}
          className={input}
        />
        <input
          required
          placeholder="address"
          aria-label="Author address"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className={input}
        />
      </div>
      <textarea
        placeholder="Short bio (optional)"
        aria-label="Author bio"
        value={bio}
        maxLength={500}
        rows={2}
        onChange={(e) => setBio(e.target.value)}
        className="rounded-sm border bg-background p-2"
      />
      <MediaField label="Photo" optional value={photo} onChange={setPhoto} />
      <span className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          className="rounded-sm"
          disabled={pending}
        >
          {author ? "Save" : "Add author"}
        </Button>
        {author && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-sm"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        )}
      </span>
    </form>
  )
}

function CategoryRow({
  category,
  canEdit,
}: {
  category: Category | null
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(category === null)
  const [name, setName] = useState(category?.name ?? "")
  const [slug, setSlug] = useState(category?.slug ?? "")
  const [description, setDescription] = useState(category?.description ?? "")
  const [pending, startTransition] = useTransition()

  if (!editing && category)
    return (
      <div className="flex items-center gap-3 border-t pt-3 text-sm first:border-t-0 first:pt-0">
        <span className="flex-1">
          <span className="font-medium">{category.name}</span>{" "}
          <span className="text-muted-foreground">
            /journal/category/{category.slug}
          </span>
          <span className="block text-xs text-muted-foreground">
            {category.posts} stor{category.posts === 1 ? "y" : "ies"}
          </span>
        </span>
        {canEdit && (
          <>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <DeleteButton
              kind="category"
              id={category.id}
              name={category.name}
              used={category.posts}
            />
          </>
        )}
      </div>
    )
  return (
    <form
      className="flex flex-col gap-2 border-t pt-3 text-sm first:border-t-0 first:pt-0"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const result = await saveCategoryAction({
            ...(category ? { id: category.id } : {}),
            name,
            slug,
            description: description.trim() || null,
          })
          if (result.ok) {
            toast.success(category ? "Category saved" : "Category added")
            if (category) setEditing(false)
            else {
              setName("")
              setSlug("")
              setDescription("")
            }
          } else toast.error(result.fieldErrors?.slug?.[0] ?? result.message)
        })
      }}
    >
      <span className="font-medium">
        {category ? `Edit ${category.name}` : "Add a category"}
      </span>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          required
          placeholder="Name"
          aria-label="Category name"
          value={name}
          maxLength={60}
          onChange={(e) => {
            setName(e.target.value)
            if (!category) setSlug(slugify(e.target.value))
          }}
          className={input}
        />
        <input
          required
          placeholder="address"
          aria-label="Category address"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className={input}
        />
      </div>
      <input
        placeholder="Description (optional)"
        aria-label="Category description"
        value={description}
        maxLength={300}
        onChange={(e) => setDescription(e.target.value)}
        className={input}
      />
      <span className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          className="rounded-sm"
          disabled={pending}
        >
          {category ? "Save" : "Add category"}
        </Button>
        {category && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-sm"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        )}
      </span>
    </form>
  )
}

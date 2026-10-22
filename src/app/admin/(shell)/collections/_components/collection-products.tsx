"use client"

import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { searchProductsAction } from "@/features/catalog/admin-actions"
import type { AdminCollection } from "@/features/collections"
import { setCollectionProductsAction } from "@/features/collections/admin-actions"

type Item = { id: string; title: string; imageKey: string | null }

/** Hand-picked products: search, add, arrange, save (doc/06 Phase 4 §5). */
export function CollectionProducts({
  collection,
  canEdit,
}: {
  collection: AdminCollection
  canEdit: boolean
}) {
  const [items, setItems] = useState<Item[]>(
    collection.products.filter((p) => p.source === "manual"),
  )
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Item[]>([])
  const [pending, startTransition] = useTransition()

  const search = (event: React.FormEvent) => {
    event.preventDefault()
    startTransition(async () => {
      const result = await searchProductsAction(query)
      if (result.ok)
        setResults(
          result.rows.map((r) => ({
            id: r.id,
            title: r.title,
            imageKey: r.imageKey,
          })),
        )
      else toast.error(result.message)
    })
  }
  const move = (index: number, by: number) => {
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    setItems(next)
  }
  const save = () =>
    startTransition(async () => {
      const result = await setCollectionProductsAction({
        collectionId: collection.id,
        productIds: items.map((i) => i.id),
        // Read from the page's data, which refreshes after every save, so
        // the details and rules editors here stay in step.
        expectedVersion: collection.version,
      })
      if (result.ok) toast.success("Products saved")
      else toast.error(result.message)
    })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-sm border bg-card p-4">
        <h3 className="mb-3 font-semibold">
          In this collection ({items.length})
        </h3>
        <ol className="divide-y text-sm">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 py-1.5">
              <span className="w-6 text-xs text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {canEdit && (
                <>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                    <span className="sr-only">Move up</span>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                    <span className="sr-only">Move down</span>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      setItems(items.filter((i) => i.id !== item.id))
                    }
                  >
                    <Trash2Icon />
                    <span className="sr-only">Remove {item.title}</span>
                  </Button>
                </>
              )}
            </li>
          ))}
        </ol>
        {canEdit && (
          <Button className="mt-3 rounded-sm" disabled={pending} onClick={save}>
            Save products
          </Button>
        )}
      </section>
      {canEdit && (
        <section className="rounded-sm border bg-card p-4">
          <form onSubmit={search} className="mb-3 flex gap-2">
            <label htmlFor="pick-search" className="sr-only">
              Find products
            </label>
            <input
              id="pick-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products to add"
              className="h-9 flex-1 rounded-sm border border-input bg-card px-2 text-sm"
            />
            <Button type="submit" variant="outline" disabled={pending}>
              Search
            </Button>
          </form>
          <ul className="divide-y text-sm">
            {results.map((r) => {
              const added = items.some((i) => i.id === r.id)
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="truncate">{r.title}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={added}
                    onClick={() => setItems([...items, r])}
                  >
                    {added ? "Added" : "Add"}
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

"use client"

import { SearchIcon } from "lucide-react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { SearchHit } from "@/features/staff"
import { adminSearchAction } from "@/features/staff/admin-actions"
import { cn } from "@/lib/utils"

type Page = { label: string; href: string }

/**
 * Ctrl/⌘+K: jump to a page, or to an order, product, customer or discount
 * by typing. Results come from staff.search, which only searches what the
 * person's role can read.
 */
export function CommandPalette({ pages }: { pages: Page[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const [, startTransition] = useTransition()
  const latest = useRef("")

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const search = (text: string) => {
    setQuery(text)
    setActive(0)
    latest.current = text
    if (text.trim().length < 2) return setHits([])
    startTransition(async () => {
      // Wait for typing to pause; drop answers to older queries.
      await new Promise((resolve) => setTimeout(resolve, 200))
      if (latest.current !== text) return
      const result = await adminSearchAction(text.trim())
      if (latest.current === text) setHits(result.ok ? result.hits : [])
    })
  }

  const needle = query.trim().toLowerCase()
  const pageHits: SearchHit[] = needle
    ? pages
        .filter((p) => p.label.toLowerCase().includes(needle))
        .map((p) => ({
          group: "Pages",
          label: p.label,
          detail: "",
          href: p.href,
        }))
    : pages.map((p) => ({
        group: "Pages",
        label: p.label,
        detail: "",
        href: p.href,
      }))
  const results = [...pageHits, ...hits]

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return
    setOpen(false)
    setQuery("")
    setHits([])
    router.push(hit.href as Route)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2 rounded-sm border bg-paper px-2 text-sm text-muted-foreground hover:bg-secondary"
      >
        <SearchIcon aria-hidden className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded-sm border px-1 text-xs sm:inline">
          ⌘K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] translate-y-0 gap-0 bg-paper p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">Search the admin</DialogTitle>
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-activedescendant={
              results[active] ? `command-${active}` : undefined
            }
            aria-label="Search orders, products, customers, discounts or pages"
            placeholder="Order number, product, customer, page…"
            value={query}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((i) => Math.min(i + 1, results.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                go(results[active])
              }
            }}
            className="h-12 w-full border-b bg-transparent px-4 text-sm outline-none"
          />
          <ul
            id="command-results"
            role="listbox"
            aria-label="Results"
            className="max-h-80 overflow-y-auto p-1"
          >
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing found.
              </li>
            )}
            {results.map((hit, index) => (
              <li
                key={`${hit.group}-${hit.href}`}
                id={`command-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(hit)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-sm",
                  index === active && "bg-secondary",
                )}
              >
                <span className="min-w-0 truncate">
                  {hit.label}
                  {hit.detail && (
                    <span className="ml-2 text-muted-foreground">
                      {hit.detail}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {hit.group}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}

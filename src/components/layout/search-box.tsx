"use client"

import { SearchIcon } from "lucide-react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"

import type { Suggestions } from "@/features/catalog"
import { formatPaise } from "@/lib/money"
import { MIN_SUGGEST_LENGTH, normaliseSearchQuery } from "@/lib/search-query"
import { cn } from "@/lib/utils"

type Option = { href: string; label: string; detail?: string }

/**
 * Search field with autocomplete (WAI-ARIA combobox). Without JavaScript it
 * is still a plain GET form to /search.
 */
export function SearchBox({
  className,
  autoFocus = false,
  onNavigate,
}: {
  className?: string
  autoFocus?: boolean
  onNavigate?: () => void
}) {
  const router = useRouter()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [result, setResult] = useState<{ query: string; data: Suggestions }>()

  const normalised = normaliseSearchQuery(query)
  useEffect(() => {
    if (normalised.length < MIN_SUGGEST_LENGTH) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(normalised)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: Suggestions | null) => {
          if (data) setResult({ query: normalised, data })
        })
        .catch(() => {
          // Aborted or offline: keep the previous suggestions.
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [normalised])

  const data =
    normalised.length >= MIN_SUGGEST_LENGTH ? result?.data : undefined
  const options: Option[] = [
    ...(data?.categories ?? []).map((category) => ({
      href: category.href,
      label: category.name,
      detail: "Category",
    })),
    ...(data?.products ?? []).map((product) => ({
      href: `/products/${product.slug}`,
      label: product.title,
      detail: formatPaise(product.pricePaise),
    })),
  ]
  const expanded = open && options.length > 0

  const go = (href: string) => {
    setOpen(false)
    setActive(-1)
    onNavigate?.()
    router.push(href as Route)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return
      event.preventDefault()
      setOpen(true)
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((current) => (current + step + options.length) % options.length)
    } else if (event.key === "Enter" && expanded && active >= 0) {
      event.preventDefault()
      go(options[active]!.href)
    } else if (event.key === "Escape") {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <form
      role="search"
      action="/search"
      className={cn("relative", className)}
      onSubmit={(event) => {
        event.preventDefault()
        if (!normalised) return inputRef.current?.focus()
        go(`/search?q=${encodeURIComponent(query.trim())}`)
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search products
      </label>
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        id={`${listId}-input`}
        name="q"
        type="search"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Search tees, shirts, hoodies…"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          expanded && active >= 0 ? `${listId}-${active}` : undefined
        }
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-10 w-full border border-input bg-card pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-rust"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-50 mt-1 max-h-96 overflow-y-auto border bg-popover py-1 text-popover-foreground shadow-lg"
      >
        {options.map((option, index) => (
          <li
            key={option.href}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // mousedown fires before the input's blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault()
              go(option.href)
            }}
            onMouseEnter={() => setActive(index)}
            className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm aria-selected:bg-muted"
          >
            <span className="line-clamp-1">{option.label}</span>
            {option.detail && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {option.detail}
              </span>
            )}
          </li>
        ))}
      </ul>
    </form>
  )
}

"use client"

import { Columns3Icon } from "lucide-react"
import { useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const storageKey = (table: string) => `duis.admin.columns.${table}`
const CHANGED = "duis-columns-changed"

function readRaw(table: string): string {
  try {
    return localStorage.getItem(storageKey(table)) ?? "[]"
  } catch {
    return "[]"
  }
}

function parse(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : []
  } catch {
    return []
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

/**
 * Show or hide table columns, remembered per browser (a convenience, so
 * localStorage is fine). The table stays server-rendered; hiding is a style
 * rule on its `data-col` cells.
 */
export function ColumnToggle({
  table,
  columns,
}: {
  table: string
  columns: { key: string; header: string }[]
}) {
  // The server renders every column; the browser's choice applies after.
  const hidden = parse(
    useSyncExternalStore(
      subscribe,
      () => readRaw(table),
      () => "[]",
    ),
  )

  const toggle = (key: string) => {
    const next = hidden.includes(key)
      ? hidden.filter((k) => k !== key)
      : [...hidden, key]
    try {
      localStorage.setItem(storageKey(table), JSON.stringify(next))
    } catch {
      // Private mode or storage off: nothing to remember.
    }
    window.dispatchEvent(new Event(CHANGED))
  }

  const safe = (value: string) => value.replace(/[^a-z0-9_-]/gi, "")
  return (
    <>
      {hidden.length > 0 && (
        <style>
          {hidden
            .map(
              (key) =>
                `[data-table="${safe(table)}"] [data-col="${safe(key)}"]{display:none}`,
            )
            .join("\n")}
        </style>
      )}
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="h-9 rounded-sm" />
          }
        >
          <Columns3Icon aria-hidden className="size-4" />
          Columns
          {hidden.length > 0 && ` (${columns.length - hidden.length})`}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 bg-paper p-2">
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 px-1 text-xs text-muted-foreground">
              Show columns
            </legend>
            {columns.map((column, index) => (
              <label key={column.key} className="flex items-center gap-2 px-1">
                <input
                  type="checkbox"
                  checked={!hidden.includes(column.key)}
                  disabled={index === 0}
                  onChange={() => toggle(column.key)}
                />
                {column.header}
              </label>
            ))}
          </fieldset>
        </PopoverContent>
      </Popover>
    </>
  )
}

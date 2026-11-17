"use client"

import {
  CircleAlertIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { useEffect } from "react"

import { cn } from "@/lib/utils"

import type { HealthItem } from "../health"
import { helperSay } from "./say"

const fixClass =
  "shrink-0 text-xs font-medium underline underline-offset-2 hover:text-foreground"

/** Opens a tab of the product page (Details, Photos, Variants & stock). */
function openTab(tab: string) {
  const trigger = document.querySelector<HTMLElement>(
    `[data-tour="tab-${tab}"]`,
  )
  trigger?.click()
  trigger?.scrollIntoView({ block: "nearest" })
}

/**
 * "Ready to sell?" on a product's page (owner decision 2026-11-17: warnings
 * never stop a publish). Pressing Publish with something still missing makes
 * the helper point here.
 */
export function ProductHealth({
  items,
  status,
}: {
  items: HealthItem[]
  status: "draft" | "active" | "archived"
}) {
  const blockers = items.filter((item) => item.level === "blocker").length

  useEffect(() => {
    if (items.length === 0) return
    const onClick = (event: MouseEvent) => {
      if (!(event.target as Element).closest('[data-tour="publish"]')) return
      helperSay({
        id: "health",
        text:
          blockers > 0
            ? "Not yet! Fix the things marked 'Must fix' first."
            : `It can go live, but ${items.length} ${items.length === 1 ? "thing" : "things"} could be better. Have a look at 'Ready to sell?'.`,
        mood: blockers > 0 ? "dizzy" : "surprised",
        target: '[data-tour="health"]',
      })
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [items.length, blockers])

  if (status === "archived") return null

  return (
    <section
      data-tour="health"
      aria-labelledby="product-health-title"
      className="mb-4 rounded-sm border bg-card p-4"
    >
      <h2
        id="product-health-title"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        {items.length === 0 ? (
          <CircleCheckIcon aria-hidden className="size-4 text-emerald-700" />
        ) : (
          <TriangleAlertIcon aria-hidden className="size-4 text-amber-700" />
        )}
        Ready to sell?
        <span className="font-normal text-muted-foreground">
          {items.length === 0
            ? "Everything looks good."
            : blockers > 0
              ? `${blockers} to fix before publishing`
              : `${items.length} ${items.length === 1 ? "suggestion" : "suggestions"}`}
        </span>
      </h2>
      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.key}
              data-health={item.key}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 text-sm"
            >
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium",
                  item.level === "blocker"
                    ? "bg-red-100 text-red-900"
                    : "bg-amber-100 text-amber-900",
                )}
              >
                <CircleAlertIcon aria-hidden className="size-3" />
                {item.level === "blocker" ? "Must fix" : "Suggested"}
              </span>
              <span className="min-w-0 flex-1">{item.message}</span>
              {"tab" in item.fix ? (
                <button
                  type="button"
                  className={fixClass}
                  onClick={() => openTab((item.fix as { tab: string }).tab)}
                >
                  {item.fixLabel}
                </button>
              ) : (
                <Link href={item.fix.href as Route} className={fixClass}>
                  {item.fixLabel}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

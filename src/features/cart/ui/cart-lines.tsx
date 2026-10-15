"use client"

import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { useTransition } from "react"
import { toast } from "sonner"

import { Price } from "@/components/brand/price"
import { MediaImage } from "@/components/media-image"
import { Button } from "@/components/ui/button"
import { STORE_POLICY } from "@/config/store-policy"
import { cn } from "@/lib/utils"

import { setCartQuantity } from "../actions"
import type { CartLine, CartLineIssue } from "../service"

const ISSUE_TEXT: Record<CartLineIssue, string> = {
  unavailable: "No longer available — please remove it.",
  sold_out: "Sold out — please remove it.",
  insufficient_stock: "Not enough stock for this quantity.",
}

export function CartLines({
  lines,
  compact = false,
  onNavigate,
}: {
  lines: CartLine[]
  compact?: boolean
  onNavigate?: () => void
}) {
  return (
    <ul className="divide-y">
      {lines.map((line) => (
        <CartLineRow
          key={line.variantId}
          line={line}
          compact={compact}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  )
}

function CartLineRow({
  line,
  compact,
  onNavigate,
}: {
  line: CartLine
  compact: boolean
  onNavigate?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const href = `/products/${line.productSlug}` as Route
  const maxQuantity = Math.min(STORE_POLICY.maxQuantityPerLine, line.available)

  const change = (quantity: number) =>
    startTransition(async () => {
      const result = await setCartQuantity({
        variantId: line.variantId,
        quantity,
      })
      if (!result.ok) toast.error(result.message)
    })

  return (
    <li
      className={cn("flex gap-4 py-4", pending && "opacity-60")}
      aria-busy={pending}
    >
      <Link
        href={href}
        onNavigate={onNavigate}
        className={cn(
          "relative shrink-0 overflow-hidden bg-secondary",
          compact ? "h-24 w-20" : "h-32 w-26",
        )}
      >
        {line.image && (
          <MediaImage
            media={line.image}
            alt=""
            fill
            sizes="104px"
            className="object-cover"
          />
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={href}
          onNavigate={onNavigate}
          className="line-clamp-2 text-sm font-medium hover:underline"
        >
          {line.title}
        </Link>
        <p className="text-xs text-muted-foreground">
          {line.options.map((option) => option.value).join(" / ")}
        </p>
        <Price pricePaise={line.unitPricePaise} mrpPaise={line.unitMrpPaise} />
        {line.issue && (
          <p className="text-xs font-medium text-destructive">
            {ISSUE_TEXT[line.issue]}
            {line.issue === "insufficient_stock" &&
              ` Only ${line.available} left.`}
          </p>
        )}
        <div className="mt-auto flex items-center gap-3 pt-1">
          {line.issue === null || line.issue === "insufficient_stock" ? (
            <div className="flex items-center border">
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-none"
                disabled={pending}
                onClick={() =>
                  change(
                    line.issue === "insufficient_stock"
                      ? line.available
                      : line.quantity - 1,
                  )
                }
                aria-label={`Decrease quantity of ${line.title}`}
              >
                <MinusIcon />
              </Button>
              <span
                className="w-8 text-center text-sm tabular-nums"
                aria-label={`Quantity ${line.quantity}`}
              >
                {line.quantity}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-none"
                disabled={pending || line.quantity >= maxQuantity}
                onClick={() => change(line.quantity + 1)}
                aria-label={`Increase quantity of ${line.title}`}
              >
                <PlusIcon />
              </Button>
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => change(0)}
            className="text-muted-foreground"
          >
            <Trash2Icon />
            Remove
            <span className="sr-only"> {line.title}</span>
          </Button>
        </div>
      </div>
    </li>
  )
}

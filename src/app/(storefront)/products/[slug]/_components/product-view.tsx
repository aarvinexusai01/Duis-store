"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, use, useState, useTransition, type ReactNode } from "react"
import { toast } from "sonner"

import { Price } from "@/components/brand/price"
import { Button } from "@/components/ui/button"
import { STORE_POLICY } from "@/config/store-policy"
import type { ProductDetail } from "@/features/catalog"
import { addToCart } from "@/features/cart/actions"
import { setCartDrawerOpen } from "@/features/cart/ui/drawer-store"
import { cn } from "@/lib/utils"
import {
  findVariant,
  initialSelection,
  optionState,
  type Selection,
  type Stock,
} from "@/lib/variant-selection"

import { Gallery } from "./gallery"

type ProductViewProps = {
  product: Pick<
    ProductDetail,
    "id" | "title" | "subtitle" | "axes" | "variants" | "media"
  >
  /** Live stock per variant id (null if it could not be read). */
  stock: Promise<Stock>
  sizeGuide?: ReactNode
  wishlist: ReactNode
  children?: ReactNode
}

/**
 * Gallery + variant picker. The selection lives in the URL (?color=&size=)
 * via history.replaceState, so a chosen variant can be shared without the
 * page itself varying by query (it stays one cache entry).
 */
export function ProductView({
  product,
  stock,
  sizeGuide,
  wishlist,
  children,
}: ProductViewProps) {
  const searchParams = useSearchParams()
  const [selection, setSelection] = useState<Selection>(() =>
    initialSelection(
      product.axes,
      product.variants,
      Object.fromEntries(searchParams.entries()),
    ),
  )

  const choose = (code: string, value: string) => {
    const next = { ...selection, [code]: value }
    // Keep only choices that still form a real combination.
    for (const axis of product.axes) {
      if (
        axis.code !== code &&
        next[axis.code] &&
        optionState(
          product.variants,
          next,
          null,
          axis.code,
          next[axis.code]!,
        ) === "missing"
      ) {
        next[axis.code] = undefined
      }
    }
    setSelection(next)
    const query = new URLSearchParams()
    for (const axis of product.axes) {
      if (next[axis.code]) query.set(axis.code, next[axis.code]!)
    }
    window.history.replaceState(null, "", `?${query}`)
  }

  const colour = selection.color
  const forColour = product.media.filter(
    (m) => m.colorSlug === null || m.colorSlug === colour,
  )
  const images = forColour.length > 0 ? forColour : product.media

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
      <Gallery images={images} title={product.title} />
      <div className="md:sticky md:top-24 md:self-start">
        <h1 className="display-heading text-4xl sm:text-5xl">
          {product.title}
        </h1>
        {product.subtitle && (
          <p className="mt-2 text-muted-foreground">{product.subtitle}</p>
        )}
        <Suspense
          fallback={
            <Purchase
              product={product}
              selection={selection}
              choose={choose}
              stock={null}
              loading
              sizeGuide={sizeGuide}
              wishlist={wishlist}
            />
          }
        >
          <LivePurchase
            product={product}
            selection={selection}
            choose={choose}
            stockPromise={stock}
            sizeGuide={sizeGuide}
            wishlist={wishlist}
          />
        </Suspense>
        {children}
      </div>
    </div>
  )
}

type PurchaseProps = {
  product: ProductViewProps["product"]
  selection: Selection
  choose: (code: string, value: string) => void
  sizeGuide?: ReactNode
  wishlist: ReactNode
}

function LivePurchase({
  stockPromise,
  ...props
}: PurchaseProps & { stockPromise: Promise<Stock> }) {
  return <Purchase {...props} stock={use(stockPromise)} loading={false} />
}

function Purchase({
  product,
  selection,
  choose,
  stock,
  loading,
  sizeGuide,
  wishlist,
}: PurchaseProps & { stock: Stock; loading: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [missing, setMissing] = useState(false)
  const variant = findVariant(product.axes, product.variants, selection)
  const available = variant && stock ? (stock[variant.id] ?? 0) : null

  // Price of the chosen variant, or the lowest one the current choices allow.
  const candidates = variant
    ? [variant]
    : product.variants.filter((v) =>
        Object.entries(selection).every(
          ([code, value]) => !value || v.options[code] === value,
        ),
      )
  const shown = [...candidates].sort((a, b) => a.pricePaise - b.pricePaise)[0]

  const add = (thenCheckout: boolean) => {
    if (!variant) {
      setMissing(true)
      return
    }
    startTransition(async () => {
      const result = await addToCart({ variantId: variant.id, quantity: 1 })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      if (thenCheckout) router.push("/cart")
      else setCartDrawerOpen(true)
    })
  }

  const soldOut = available === 0
  return (
    <div className="mt-4 flex flex-col gap-6">
      {shown && (
        <div>
          <Price
            size="lg"
            pricePaise={shown.pricePaise}
            mrpPaise={shown.mrpPaise}
            from={
              !variant &&
              candidates.some((v) => v.pricePaise !== shown.pricePaise)
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            MRP inclusive of all taxes
          </p>
        </div>
      )}

      {product.axes.map((axis) => {
        const chosen = axis.values.find(
          (value) => value.slug === selection[axis.code],
        )
        const isColour = axis.code === "color"
        return (
          <fieldset key={axis.code}>
            <div className="mb-2 flex items-center justify-between">
              <legend className="text-sm font-semibold tracking-wide uppercase">
                {axis.name}
                {chosen && (
                  <span className="font-normal normal-case">
                    : {chosen.label}
                  </span>
                )}
              </legend>
              {axis.code === "size" && sizeGuide}
            </div>
            <div className="flex flex-wrap gap-2">
              {axis.values.map((value) => {
                const state = optionState(
                  product.variants,
                  selection,
                  stock,
                  axis.code,
                  value.slug,
                )
                const selected = selection[axis.code] === value.slug
                // Colours stay selectable to view their photos; sizes that
                // cannot be bought are disabled.
                const disabled = !isColour && state !== "available"
                return (
                  <label
                    key={value.slug}
                    className={cn(
                      "relative cursor-pointer",
                      disabled && "cursor-not-allowed",
                    )}
                  >
                    <input
                      type="radio"
                      name={`axis-${axis.code}`}
                      value={value.slug}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => {
                        setMissing(false)
                        choose(axis.code, value.slug)
                      }}
                      className="peer sr-only"
                    />
                    {isColour ? (
                      <span
                        className={cn(
                          "flex size-10 items-center justify-center rounded-full border-2 border-transparent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-rust",
                          selected && "border-ink",
                        )}
                      >
                        <span
                          className="size-7 rounded-full border border-ink/20"
                          style={{
                            backgroundColor: value.hex ?? "transparent",
                          }}
                        />
                        <span className="sr-only">
                          {value.label}
                          {state === "sold_out" && " (sold out)"}
                        </span>
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "flex h-11 min-w-12 items-center justify-center border px-3 text-sm font-medium uppercase peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-rust",
                          selected
                            ? "border-ink bg-ink text-paper"
                            : "border-input bg-card hover:border-ink",
                          disabled &&
                            "border-dashed text-muted-foreground line-through hover:border-input",
                        )}
                      >
                        {value.label}
                        {state === "sold_out" && (
                          <span className="sr-only"> (sold out)</span>
                        )}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )
      })}

      <p role="status" className="min-h-5 text-sm font-medium">
        {missing && !variant ? (
          <span className="text-destructive">
            Please choose a{" "}
            {product.axes.find((a) => !selection[a.code])?.name.toLowerCase() ??
              "option"}
            .
          </span>
        ) : loading ? (
          <span className="text-muted-foreground">Checking stock…</span>
        ) : available === null ? null : soldOut ? (
          <span className="text-destructive">Sold out in this size</span>
        ) : available <= STORE_POLICY.lowStockNoticeAt ? (
          <span className="text-rust">Only {available} left</span>
        ) : (
          <span className="text-emerald-800">In stock</span>
        )}
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            onClick={() => add(false)}
            disabled={pending || soldOut}
            className="h-12 flex-1 rounded-none text-sm font-semibold tracking-wider uppercase"
          >
            {soldOut ? "Sold out" : pending ? "Adding…" : "Add to bag"}
          </Button>
          {wishlist}
        </div>
        <Button
          variant="outline"
          onClick={() => add(true)}
          disabled={pending || soldOut}
          className="h-12 rounded-none border-ink text-sm font-semibold tracking-wider uppercase"
        >
          Buy now
        </Button>
      </div>
    </div>
  )
}

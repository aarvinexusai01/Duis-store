"use client"

import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import { StockDialog } from "@/components/admin/stock-dialog"
import { Button } from "@/components/ui/button"
import type { AdminProduct, CatalogOptions } from "@/features/catalog"
import {
  generateVariantsAction,
  saveVariantsAction,
} from "@/features/catalog/admin-actions"
import { cn } from "@/lib/utils"

type Variant = AdminProduct["variants"][number]

const rupees = (paise: number) =>
  (paise / 100).toFixed(paise % 100 === 0 ? 0 : 2)
const toPaise = (value: string) => Math.round(Number(value) * 100)
const cell =
  "h-8 w-full rounded-sm border border-input bg-card px-1.5 text-sm tabular-nums"

/**
 * Variants (doc/06 Phase 4 §3): generate colour × size combinations, then
 * edit SKU, price, MRP and status in a grid with bulk fill. Stock changes go
 * through receive/adjust/count so every change is a recorded movement.
 */
export function VariantsPanel({
  product,
  options,
  canEdit,
  canAdjust,
}: {
  product: AdminProduct
  options: CatalogOptions
  canEdit: boolean
  canAdjust: boolean
}) {
  const axes = product.axisAttributeIds
    .map((id) => options.attributes.find((a) => a.id === id))
    .filter((a): a is CatalogOptions["attributes"][number] => Boolean(a))
  const [rows, setRows] = useState(product.variants)
  const [pending, startTransition] = useTransition()
  const [stockFor, setStockFor] = useState<Variant | null>(null)
  // Only the editable fields count as changes; stock comes from the server.
  const editable = (v: Variant) =>
    [v.sku, v.pricePaise, v.mrpPaise, v.status].join("|")
  const changed = useMemo(
    () =>
      rows.filter((row) => {
        const original = product.variants.find((v) => v.id === row.id)
        return original && editable(original) !== editable(row)
      }),
    [rows, product.variants],
  )
  const live = new Map(product.variants.map((v) => [v.id, v]))

  const update = (id: string, patch: Partial<Variant>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const save = () =>
    startTransition(async () => {
      for (const row of changed) {
        if (row.mrpPaise < row.pricePaise) {
          toast.error(`${row.sku}: the MRP can't be lower than the price.`)
          return
        }
      }
      const result = await saveVariantsAction(
        changed.map((row) => ({
          id: row.id,
          sku: row.sku,
          pricePaise: row.pricePaise,
          mrpPaise: row.mrpPaise,
          status: row.status,
        })),
      )
      if (result.ok) toast.success(`${result.saved} variants saved`)
      else toast.error(result.message)
    })

  return (
    <div className="flex flex-col gap-6">
      {canEdit && <Generator product={product} axes={axes} />}

      {rows.length > 0 && (
        <section className="flex flex-col gap-3">
          {canEdit && (
            <BulkFill
              onFill={(patch) => setRows(rows.map((r) => ({ ...r, ...patch })))}
            />
          )}
          <div className="overflow-x-auto rounded-sm border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-secondary/50 text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-2 py-2">Variant</th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Price ₹</th>
                  <th className="px-2 py-2">MRP ₹</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">On hand</th>
                  <th className="px-2 py-2 text-right">Reserved</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(changed.includes(row) && "bg-amber-50")}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {row.label}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        aria-label={`SKU for ${row.label}`}
                        value={row.sku}
                        disabled={!canEdit}
                        onChange={(e) =>
                          update(row.id, { sku: e.target.value.toUpperCase() })
                        }
                        className={cn(cell, "min-w-36")}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        aria-label={`Price for ${row.label}`}
                        type="number"
                        min={1}
                        step="0.01"
                        disabled={!canEdit}
                        value={rupees(row.pricePaise)}
                        onChange={(e) =>
                          update(row.id, {
                            pricePaise: toPaise(e.target.value),
                          })
                        }
                        className={cn(cell, "w-24")}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        aria-label={`MRP for ${row.label}`}
                        type="number"
                        min={1}
                        step="0.01"
                        disabled={!canEdit}
                        value={rupees(row.mrpPaise)}
                        onChange={(e) =>
                          update(row.id, { mrpPaise: toPaise(e.target.value) })
                        }
                        className={cn(cell, "w-24")}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        aria-label={`Status for ${row.label}`}
                        value={row.status}
                        disabled={!canEdit}
                        onChange={(e) =>
                          update(row.id, {
                            status: e.target.value as Variant["status"],
                          })
                        }
                        className={cn(cell, "w-28")}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {row.onHand}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                      {row.reserved}
                    </td>
                    <td className="px-2 py-1.5">
                      {canAdjust && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setStockFor(live.get(row.id) ?? row)}
                        >
                          Stock
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div className="flex justify-end">
              <Button
                type="button"
                className="rounded-sm"
                disabled={changed.length === 0 || pending}
                onClick={save}
              >
                {pending
                  ? "Saving…"
                  : changed.length
                    ? `Save ${changed.length} changes`
                    : "Save changes"}
              </Button>
            </div>
          )}
        </section>
      )}
      <StockDialog variant={stockFor} onClose={() => setStockFor(null)} />
    </div>
  )
}

function BulkFill({ onFill }: { onFill: (patch: Partial<Variant>) => void }) {
  const [price, setPrice] = useState("")
  const [mrp, setMrp] = useState("")
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <span className="text-muted-foreground">Fill every row:</span>
      <label className="flex flex-col text-xs">
        Price ₹
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          min={1}
          step="0.01"
          className={cn(cell, "w-24")}
        />
      </label>
      <label className="flex flex-col text-xs">
        MRP ₹
        <input
          value={mrp}
          onChange={(e) => setMrp(e.target.value)}
          type="number"
          min={1}
          step="0.01"
          className={cn(cell, "w-24")}
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          onFill({
            ...(price ? { pricePaise: toPaise(price) } : {}),
            ...(mrp ? { mrpPaise: toPaise(mrp) } : {}),
          })
        }
      >
        Apply
      </Button>
    </div>
  )
}

function Generator({
  product,
  axes,
}: {
  product: AdminProduct
  axes: CatalogOptions["attributes"]
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {}
    for (const axis of axes) {
      initial[axis.id] = [
        ...new Set(
          product.variants
            .map(
              (v) =>
                axis.values.find((x) => x.slug === v.options[axis.code])?.id,
            )
            .filter((x): x is string => Boolean(x)),
        ),
      ]
    }
    return initial
  })
  const [pending, startTransition] = useTransition()
  const count = axes.reduce(
    (n, axis) => n * (selected[axis.id]?.length ?? 0),
    1,
  )

  const generate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await generateVariantsAction({
        productId: product.id,
        axes: axes.map((axis) => ({
          attributeId: axis.id,
          valueIds: selected[axis.id] ?? [],
        })),
        pricePaise: toPaise(String(form.get("price"))),
        mrpPaise: toPaise(String(form.get("mrp"))),
        skuPrefix: String(form.get("skuPrefix")).toUpperCase(),
        initialStock: Number(form.get("initialStock") || 0),
      })
      if (result.ok) toast.success("Variants created")
      else toast.error(result.message)
    })
  }

  return (
    <form
      onSubmit={generate}
      className="flex flex-col gap-4 rounded-sm border bg-card p-4"
    >
      <div>
        <h3 className="font-semibold">Generate variants</h3>
        <p className="text-sm text-muted-foreground">
          Tick the values to sell; every missing combination is created.
          Existing variants are kept.
        </p>
      </div>
      {axes.map((axis) => (
        <fieldset key={axis.id}>
          <legend className="mb-1 text-sm font-medium">{axis.name}</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {axis.values.map((value) => (
              <label
                key={value.id}
                className="flex items-center gap-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected[axis.id]?.includes(value.id) ?? false}
                  onChange={() =>
                    setSelected((current) => {
                      const list = current[axis.id] ?? []
                      return {
                        ...current,
                        [axis.id]: list.includes(value.id)
                          ? list.filter((x) => x !== value.id)
                          : [...list, value.id],
                      }
                    })
                  }
                />
                {value.swatchHex && (
                  <span
                    aria-hidden
                    className="size-3 rounded-full border"
                    style={{ background: value.swatchHex }}
                  />
                )}
                {value.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Price ₹
          <input
            name="price"
            type="number"
            min={1}
            step="0.01"
            required
            className={cell}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          MRP ₹
          <input
            name="mrp"
            type="number"
            min={1}
            step="0.01"
            required
            className={cell}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          SKU prefix
          <input
            name="skuPrefix"
            defaultValue={product.slug.toUpperCase().slice(0, 20)}
            required
            pattern="[A-Za-z0-9-]{2,30}"
            className={cell}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Starting stock each
          <input
            name="initialStock"
            type="number"
            min={0}
            defaultValue={0}
            className={cell}
          />
        </label>
      </div>
      <Button
        type="submit"
        className="w-fit rounded-sm"
        disabled={pending || count === 0}
      >
        {pending ? "Creating…" : `Create up to ${count} variants`}
      </Button>
    </form>
  )
}

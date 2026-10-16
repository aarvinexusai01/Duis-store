"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  adjustStockAction,
  setCountedStockAction,
} from "@/features/inventory/admin-actions"

const cell =
  "h-8 w-full rounded-sm border border-input bg-card px-1.5 text-sm tabular-nums"

type StockTarget = {
  id: string
  label: string
  onHand: number
  reserved: number
}

/** Receive, write off, correct or count stock; every change is a movement. */
export function StockDialog({
  variant,
  onClose,
}: {
  variant: StockTarget | null
  onClose: () => void
}) {
  const [mode, setMode] = useState<"receive" | "adjust" | "damaged" | "count">(
    "receive",
  )
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!variant) return
    const form = new FormData(event.currentTarget)
    const amount = Number(form.get("amount"))
    const note = String(form.get("note") ?? "").trim() || undefined
    startTransition(async () => {
      const result =
        mode === "count"
          ? await setCountedStockAction({
              variantId: variant.id,
              counted: amount,
              note,
            })
          : await adjustStockAction({
              variantId: variant.id,
              delta:
                mode === "receive"
                  ? Math.abs(amount)
                  : mode === "damaged"
                    ? -Math.abs(amount)
                    : amount,
              reason: mode,
              note,
            })
      if (result.ok) {
        toast.success("Stock updated")
        onClose()
      } else toast.error(result.message)
    })
  }
  return (
    <Dialog open={variant !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-paper">
        <DialogHeader>
          <DialogTitle>Stock: {variant?.label}</DialogTitle>
          <DialogDescription>
            On hand {variant?.onHand} · reserved {variant?.reserved}. Every
            change is recorded with your name.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            What happened
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className={cell}
            >
              <option value="receive">Received new stock (+)</option>
              <option value="damaged">Damaged or lost (−)</option>
              <option value="adjust">Other correction (±)</option>
              <option value="count">Physical count (set exact number)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {mode === "count"
              ? "Counted on the shelf"
              : mode === "adjust"
                ? "Change (use − to remove)"
                : "Quantity"}
            <input
              name="amount"
              type="number"
              required
              step={1}
              min={mode === "adjust" ? undefined : 0}
              className={cell}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note
            <input name="note" maxLength={300} className={cell} />
          </label>
          <Button type="submit" disabled={pending} className="rounded-sm">
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { StockDialog } from "@/components/admin/stock-dialog"
import { Button } from "@/components/ui/button"
import { setThresholdAction } from "@/features/inventory/admin-actions"

export function StockRowActions({
  variantId,
  label,
  onHand,
  reserved,
  threshold,
}: {
  variantId: string
  label: string
  onHand: number
  reserved: number
  threshold: number
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(String(threshold))
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex items-center justify-end gap-2">
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        Alert at
        <input
          aria-label={`Low-stock alert level for ${label}`}
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (Number(value) === threshold) return
            startTransition(async () => {
              const result = await setThresholdAction({
                variantId,
                threshold: Number(value),
              })
              if (!result.ok) toast.error(result.message)
            })
          }}
          disabled={pending}
          className="h-7 w-14 rounded-sm border border-input bg-card px-1 text-sm"
        />
      </label>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Adjust
      </Button>
      <StockDialog
        variant={open ? { id: variantId, label, onHand, reserved } : null}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}

"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { generateCouponsAction } from "@/features/discounts/admin-actions"
import { csvCell } from "@/lib/csv"

const field = "h-9 w-full rounded-sm border border-input bg-paper px-2 text-sm"

/** Generates unique codes and offers them as a CSV download. */
export function CouponGenerator({ discountId }: { discountId: string }) {
  const [codes, setCodes] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await generateCouponsAction({
        discountId,
        count: Number(form.get("count")),
        prefix: String(form.get("prefix") ?? ""),
        usageLimit: Number(form.get("usageLimit")) || null,
      })
      if (!result.ok) return void toast.error(result.message)
      setCodes(result.codes)
      toast.success(`${result.codes.length} codes created`)
    })
  }
  const download = () => {
    const blob = new Blob([["code", ...codes].map(csvCell).join("\n")], {
      type: "text/csv",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "coupon-codes.csv"
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="mt-4 border-t pt-4">
      <h3 className="mb-2 font-medium">Generate codes</h3>
      <form onSubmit={submit} className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          How many
          <input
            name="count"
            type="number"
            min={1}
            max={1000}
            defaultValue={50}
            required
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Prefix
          <input
            name="prefix"
            maxLength={12}
            pattern="[A-Za-z0-9]*"
            placeholder="DIWALI"
            className={`${field} uppercase`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Uses each
          <input
            name="usageLimit"
            type="number"
            min={1}
            max={1000}
            defaultValue={1}
            className={field}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className="col-span-3 rounded-sm"
        >
          {pending ? "Generating…" : "Generate"}
        </Button>
      </form>
      {codes.length > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={download}
          className="mt-2 w-full rounded-sm"
        >
          Download {codes.length} new codes (CSV)
        </Button>
      )}
    </div>
  )
}

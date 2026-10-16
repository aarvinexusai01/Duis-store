"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { RemittanceProblem } from "@/features/orders"
import { importCodRemittancesAction } from "@/features/orders/admin-actions"

type Summary = {
  rows: number
  matched: number
  already: number
  problems: RemittanceProblem[]
}

/** Uploads a remittance CSV and lists the rows that didn't match. */
export function RemittanceImport() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0)
      return void toast.error("Choose a CSV file.")
    if (file.size > 1_000_000)
      return void toast.error("The file is too large (1 MB at most).")
    startTransition(async () => {
      const result = await importCodRemittancesAction({
        csv: await file.text(),
        batchRef: String(form.get("batchRef") ?? "") || undefined,
      })
      if (!result.ok) return void toast.error(result.message)
      setSummary(result)
      toast.success(`${result.matched} remittances recorded`)
    })
  }
  return (
    <section className="rounded-sm border bg-card p-4">
      <h2 className="font-semibold">Import a remittance file</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A CSV with columns for the <strong>AWB</strong> or{" "}
        <strong>order number</strong>, <strong>amount</strong>,{" "}
        <strong>UTR</strong> and <strong>date</strong>. Rows match only when the
        amount equals the cash due.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          CSV file
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Batch reference (optional)
          <input
            name="batchRef"
            maxLength={100}
            className="h-9 rounded-sm border border-input bg-paper px-2 text-sm"
          />
        </label>
        <Button type="submit" disabled={pending} className="rounded-sm">
          {pending ? "Importing…" : "Import"}
        </Button>
      </form>
      {summary && (
        <div role="status" className="mt-4 text-sm">
          <p>
            {summary.rows} rows: {summary.matched} recorded, {summary.already}{" "}
            already recorded, {summary.problems.length} need a look.
          </p>
          {summary.problems.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {summary.problems.map((p) => (
                <li key={p.line} className="text-destructive">
                  Line {p.line} ({p.reference}): {p.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

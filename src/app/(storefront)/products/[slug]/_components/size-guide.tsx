"use client"

import { RulerIcon } from "lucide-react"
import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { ProductDetail } from "@/features/catalog"
import { convertMeasurement, type SizeUnit } from "@/lib/size-units"
import { cn } from "@/lib/utils"

const UNIT_NAMES: Record<SizeUnit, string> = {
  in: "inches",
  cm: "centimetres",
}

/**
 * The size guide: the category's chart, switchable between inches and
 * centimetres (owner decision 2026-10-23); the stored unit is the default.
 */
export function SizeGuide({
  chart,
}: {
  chart: NonNullable<ProductDetail["sizeChart"]>
}) {
  const stored: SizeUnit = chart.unit === "cm" ? "cm" : "in"
  const [unit, setUnit] = useState<SizeUnit>(stored)
  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-4">
        <RulerIcon className="size-3.5" aria-hidden />
        Size guide
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-paper sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide uppercase">
            {chart.name}
          </DialogTitle>
          <DialogDescription>
            Measurements in {UNIT_NAMES[unit]}.
          </DialogDescription>
        </DialogHeader>
        <div
          role="group"
          aria-label="Units"
          className="inline-flex w-fit border border-ink"
        >
          {(["in", "cm"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={unit === option}
              onClick={() => setUnit(option)}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold tracking-wider uppercase",
                unit === option ? "bg-ink text-paper" : "bg-paper text-ink",
              )}
            >
              {option === "in" ? "Inches" : "CM"}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-ink text-paper">
                <th scope="col" className="px-3 py-2 text-left">
                  Size
                </th>
                {chart.chart.columns.map((column) => (
                  <th key={column} scope="col" className="px-3 py-2 text-left">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.chart.rows.map((row) => (
                <tr key={row.size} className="border-b">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    {row.size}
                  </th>
                  {row.values.map((value, index) => (
                    <td key={index} className="px-3 py-2 tabular-nums">
                      {convertMeasurement(value, stored, unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {chart.howToMeasure && (
          <p className="text-sm whitespace-pre-line text-muted-foreground">
            {chart.howToMeasure}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

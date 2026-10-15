"use client"

import { RulerIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { ProductDetail } from "@/features/catalog"

export function SizeGuide({
  chart,
}: {
  chart: NonNullable<ProductDetail["sizeChart"]>
}) {
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
            Garment measurements in{" "}
            {chart.unit === "in" ? "inches" : "centimetres"}.
          </DialogDescription>
        </DialogHeader>
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
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {chart.howToMeasure && (
          <p className="text-sm text-muted-foreground">{chart.howToMeasure}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

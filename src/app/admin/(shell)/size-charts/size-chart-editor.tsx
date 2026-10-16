"use client"

import { PlusIcon, Trash2Icon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { SizeChartRow } from "@/features/catalog"
import {
  createSizeChartAction,
  updateSizeChartAction,
} from "@/features/catalog/admin-actions"

const cell =
  "h-8 w-full min-w-16 rounded-sm border border-input bg-card px-1.5 text-sm"

export function SizeChartEditor({
  chart,
  canEdit,
}: {
  chart: SizeChartRow | null
  canEdit: boolean
}) {
  const [name, setName] = useState(chart?.name ?? "")
  const [unit, setUnit] = useState<"in" | "cm">(chart?.unit ?? "in")
  const [columns, setColumns] = useState(
    chart?.chart.columns ?? ["Chest", "Length"],
  )
  const [rows, setRows] = useState(
    chart?.chart.rows ?? [{ size: "M", values: ["", ""] }],
  )
  const [howTo, setHowTo] = useState(chart?.howToMeasure ?? "")
  const [pending, startTransition] = useTransition()

  const setColumnCount = (next: string[]) => {
    setColumns(next)
    setRows(
      rows.map((r) => ({
        ...r,
        values: next.map((_, i) => r.values[i] ?? ""),
      })),
    )
  }

  const save = () =>
    startTransition(async () => {
      const payload = {
        name,
        unit,
        chart: { columns, rows },
        howToMeasure: howTo || null,
      }
      const result = chart
        ? await updateSizeChartAction({ ...payload, id: chart.id })
        : await createSizeChartAction(payload)
      if (result.ok) {
        toast.success("Size chart saved")
        if (!chart) {
          setName("")
          setRows([{ size: "M", values: columns.map(() => "") }])
        }
      } else toast.error(result.message)
    })

  return (
    <section className="flex flex-col gap-3 rounded-sm border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          {chart ? "Name" : "New size chart"}
          <input
            value={name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
            placeholder="Oversized tees"
            className={`${cell} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1">
          Unit
          <select
            value={unit}
            disabled={!canEdit}
            onChange={(e) => setUnit(e.target.value as "in" | "cm")}
            className={`${cell} w-24`}
          >
            <option value="in">inches</option>
            <option value="cm">cm</option>
          </select>
        </label>
        {chart && (
          <span className="text-xs text-muted-foreground">
            Used by {chart.categoryCount} categories
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              <th className="px-1 py-1 text-left text-xs text-muted-foreground">
                Size
              </th>
              {columns.map((column, i) => (
                <th key={i} className="px-1 py-1">
                  <div className="flex gap-1">
                    <input
                      aria-label={`Column ${i + 1}`}
                      value={column}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setColumnCount(
                          columns.map((c, j) => (j === i ? e.target.value : c)),
                        )
                      }
                      className={cell}
                    />
                    {canEdit && columns.length > 1 && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() =>
                          setColumnCount(columns.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2Icon />
                        <span className="sr-only">Remove column</span>
                      </Button>
                    )}
                  </div>
                </th>
              ))}
              {canEdit && (
                <th>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setColumnCount([...columns, ""])}
                  >
                    <PlusIcon />
                    <span className="sr-only">Add column</span>
                  </Button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="px-1 py-1">
                  <input
                    aria-label={`Size ${r + 1}`}
                    value={row.size}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setRows(
                        rows.map((x, j) =>
                          j === r ? { ...x, size: e.target.value } : x,
                        ),
                      )
                    }
                    className={`${cell} w-20`}
                  />
                </td>
                {columns.map((_, c) => (
                  <td key={c} className="px-1 py-1">
                    <input
                      aria-label={`${row.size} ${columns[c]}`}
                      value={row.values[c] ?? ""}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setRows(
                          rows.map((x, j) =>
                            j === r
                              ? {
                                  ...x,
                                  values: x.values.map((v, k) =>
                                    k === c ? e.target.value : v,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      className={cell}
                    />
                  </td>
                ))}
                {canEdit && (
                  <td>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setRows(rows.filter((_, j) => j !== r))}
                    >
                      <Trash2Icon />
                      <span className="sr-only">Remove size</span>
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() =>
              setRows([...rows, { size: "", values: columns.map(() => "") }])
            }
          >
            <PlusIcon /> Add size
          </Button>
          <label className="flex flex-col gap-1 text-sm">
            How to measure
            <textarea
              value={howTo}
              onChange={(e) => setHowTo(e.target.value)}
              rows={2}
              className="rounded-sm border border-input bg-card px-2 py-1"
            />
          </label>
          <Button
            className="w-fit rounded-sm"
            disabled={pending || !name.trim()}
            onClick={save}
          >
            {pending ? "Saving…" : chart ? "Save chart" : "Create chart"}
          </Button>
        </>
      )}
    </section>
  )
}

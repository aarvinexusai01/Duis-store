"use client"

import { PlusIcon, Trash2Icon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { CatalogOptions } from "@/features/catalog"
import type { AdminCollection } from "@/features/collections"
import {
  previewRulesAction,
  updateCollectionAction,
} from "@/features/collections/admin-actions"

type Rule = AdminCollection["rules"][number]
type Field = Rule["field"]

const FIELDS: { value: Field; label: string }[] = [
  { value: "category", label: "In category" },
  { value: "attribute_value", label: "Has attribute value" },
  { value: "tag", label: "Has tag" },
  { value: "price", label: "Price" },
  { value: "created_within_days", label: "Published within" },
  { value: "best_selling", label: "Among best sellers" },
]

const input = "h-8 rounded-sm border border-input bg-card px-2 text-sm"

function blank(field: Field): Rule {
  switch (field) {
    case "category":
      return { field, categoryIds: [] }
    case "attribute_value":
      return { field, attributeValueIds: [] }
    case "tag":
      return { field, tags: [] }
    case "price":
      return { field, operator: "lte", valuePaise: 99_900 }
    case "created_within_days":
      return { field, days: 30 }
    case "best_selling":
      return { field, top: 24 }
  }
}

/** Automatic collection rules with a live match count. */
export function RuleBuilder({
  collection,
  options,
  canEdit,
}: {
  collection: AdminCollection
  options: CatalogOptions
  canEdit: boolean
}) {
  const [rules, setRules] = useState<Rule[]>(collection.rules)
  const [match, setMatch] = useState(collection.ruleMatch)
  const [preview, setPreview] = useState<{
    count: number
    sample: string[]
  } | null>(null)
  const [pending, startTransition] = useTransition()

  const set = (index: number, rule: Rule) =>
    setRules(rules.map((r, i) => (i === index ? rule : r)))
  const valid =
    rules.length > 0 &&
    rules.every((r) =>
      r.field === "category"
        ? r.categoryIds.length > 0
        : r.field === "attribute_value"
          ? r.attributeValueIds.length > 0
          : r.field === "tag"
            ? r.tags.length > 0
            : true,
    )

  const check = () =>
    startTransition(async () => {
      const result = await previewRulesAction({ rules, ruleMatch: match })
      if (result.ok) setPreview({ count: result.count, sample: result.sample })
      else toast.error(result.message)
    })
  const save = () =>
    startTransition(async () => {
      const result = await updateCollectionAction({
        id: collection.id,
        rules,
        ruleMatch: match,
        expectedVersion: collection.version,
      })
      if (result.ok)
        toast.success(
          "Rules saved; the collection refreshes in the background.",
        )
      else toast.error(result.message)
    })

  return (
    <section className="flex flex-col gap-3 rounded-sm border bg-card p-4 text-sm">
      <label className="flex items-center gap-2">
        Products must match
        <select
          value={match}
          disabled={!canEdit}
          onChange={(e) => setMatch(e.target.value as "all" | "any")}
          className={input}
        >
          <option value="all">all rules</option>
          <option value="any">any rule</option>
        </select>
      </label>
      <ul className="flex flex-col gap-2">
        {rules.map((rule, index) => (
          <li
            key={index}
            className="flex flex-wrap items-start gap-2 rounded-sm border p-2"
          >
            <select
              value={rule.field}
              disabled={!canEdit}
              onChange={(e) => set(index, blank(e.target.value as Field))}
              className={input}
              aria-label="Rule type"
            >
              {FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            {rule.field === "category" && (
              <select
                multiple
                aria-label="Categories"
                value={rule.categoryIds}
                disabled={!canEdit}
                onChange={(e) =>
                  set(index, {
                    ...rule,
                    categoryIds: Array.from(
                      e.target.selectedOptions,
                      (o) => o.value,
                    ),
                  })
                }
                className="h-28 min-w-60 rounded-sm border border-input bg-card text-sm"
              >
                {options.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {"— ".repeat(c.depth)}
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {rule.field === "attribute_value" && (
              <select
                multiple
                aria-label="Attribute values"
                value={rule.attributeValueIds}
                disabled={!canEdit}
                onChange={(e) =>
                  set(index, {
                    ...rule,
                    attributeValueIds: Array.from(
                      e.target.selectedOptions,
                      (o) => o.value,
                    ),
                  })
                }
                className="h-28 min-w-60 rounded-sm border border-input bg-card text-sm"
              >
                {options.attributes.map((a) => (
                  <optgroup key={a.id} label={a.name}>
                    {a.values.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            {rule.field === "tag" && (
              <input
                aria-label="Tags"
                placeholder="tag1, tag2"
                defaultValue={rule.tags.join(", ")}
                disabled={!canEdit}
                onChange={(e) =>
                  set(index, {
                    ...rule,
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim().toLowerCase())
                      .filter(Boolean),
                  })
                }
                className={`${input} w-56`}
              />
            )}
            {rule.field === "price" && (
              <>
                <select
                  aria-label="Comparison"
                  value={rule.operator}
                  disabled={!canEdit}
                  onChange={(e) =>
                    set(index, {
                      ...rule,
                      operator: e.target.value as "lte" | "gte",
                    })
                  }
                  className={input}
                >
                  <option value="lte">at most</option>
                  <option value="gte">at least</option>
                </select>
                <label className="flex items-center gap-1">
                  ₹
                  <input
                    aria-label="Price in rupees"
                    type="number"
                    min={1}
                    value={rule.valuePaise / 100}
                    disabled={!canEdit}
                    onChange={(e) =>
                      set(index, {
                        ...rule,
                        valuePaise: Math.round(Number(e.target.value) * 100),
                      })
                    }
                    className={`${input} w-24`}
                  />
                </label>
              </>
            )}
            {rule.field === "created_within_days" && (
              <label className="flex items-center gap-1">
                <input
                  aria-label="Days"
                  type="number"
                  min={1}
                  max={365}
                  value={rule.days}
                  disabled={!canEdit}
                  onChange={(e) =>
                    set(index, { ...rule, days: Number(e.target.value) })
                  }
                  className={`${input} w-20`}
                />
                days
              </label>
            )}
            {rule.field === "best_selling" && (
              <label className="flex items-center gap-1">
                top
                <input
                  aria-label="Top"
                  type="number"
                  min={1}
                  max={200}
                  value={rule.top}
                  disabled={!canEdit}
                  onChange={(e) =>
                    set(index, { ...rule, top: Number(e.target.value) })
                  }
                  className={`${input} w-20`}
                />
              </label>
            )}
            {canEdit && rules.length > 1 && (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setRules(rules.filter((_, i) => i !== index))}
              >
                <Trash2Icon />
                <span className="sr-only">Remove rule</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={rules.length >= 10}
          onClick={() => setRules([...rules, blank("category")])}
        >
          <PlusIcon /> Add rule
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!valid || pending}
          onClick={check}
        >
          Preview matches
        </Button>
        {preview && (
          <span role="status">
            <strong>{preview.count}</strong> active products match
            {preview.sample.length > 0 &&
              `, e.g. ${preview.sample.slice(0, 3).join(", ")}`}
          </span>
        )}
      </div>
      {canEdit && (
        <Button
          className="w-fit rounded-sm"
          disabled={!valid || pending}
          onClick={save}
        >
          Save rules
        </Button>
      )}
    </section>
  )
}

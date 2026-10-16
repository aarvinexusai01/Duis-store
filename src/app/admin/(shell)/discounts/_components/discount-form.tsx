"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { AdminDiscountDetail } from "@/features/discounts"
import {
  createDiscountAction,
  updateDiscountAction,
} from "@/features/discounts/admin-actions"

const field = "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm"

type Target = {
  type: "product" | "variant" | "category" | "collection"
  id: string
}
type Option = { id: string; label: string }

/** "2026-10-16T10:00" in IST, for <input type="datetime-local">. */
function toLocal(date: Date | null): string {
  if (!date) return ""
  return date
    .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
    .slice(0, 16)
    .replace(" ", "T")
}
const fromLocal = (value: string) =>
  value ? new Date(`${value}:00+05:30`).toISOString() : null

/**
 * Create or edit a discount. Targets are categories and collections here;
 * product targets made elsewhere are kept as they are.
 */
export function DiscountForm({
  discount,
  categories,
  collections,
}: {
  discount: AdminDiscountDetail | null
  categories: Option[]
  collections: Option[]
}) {
  const [kind, setKind] = useState<"automatic" | "coupon">(
    discount?.kind ?? "coupon",
  )
  const [valueType, setValueType] = useState<"percentage" | "fixed">(
    discount?.valueType ?? "percentage",
  )
  const [targets, setTargets] = useState<Target[]>(
    (discount?.targets ?? []) as Target[],
  )
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})
  const [pending, startTransition] = useTransition()

  const toggle = (type: Target["type"], id: string) =>
    setTargets((current) =>
      current.some((t) => t.type === type && t.id === id)
        ? current.filter((t) => !(t.type === type && t.id === id))
        : [...current, { type, id }],
    )
  const kept = targets.filter(
    (t) => t.type === "product" || t.type === "variant",
  )

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "").trim()
    const optionalInt = (name: string, scale = 1) =>
      text(name) ? Math.round(Number(text(name)) * scale) : null
    const fields = {
      name: text("name"),
      valueType,
      // Percent → basis points, rupees → paise: both ×100.
      value: Math.round(Number(text("value")) * 100),
      maxDiscountPaise:
        valueType === "percentage" ? optionalInt("maxDiscount", 100) : null,
      minOrderPaise: optionalInt("minOrder", 100) ?? 0,
      targets,
      eligibility: {
        firstOrderOnly: form.get("firstOrderOnly") === "on" || undefined,
        phoneVerifiedOnly: form.get("phoneVerifiedOnly") === "on" || undefined,
        ...(discount?.eligibility.userIds
          ? { userIds: discount.eligibility.userIds }
          : {}),
      },
      combinable: form.get("combinable") === "on",
      priority: optionalInt("priority") ?? 0,
      startsAt: fromLocal(text("startsAt")) ?? undefined,
      endsAt: fromLocal(text("endsAt")),
      usageLimitTotal: optionalInt("usageLimitTotal"),
      usageLimitPerCustomer: optionalInt("usageLimitPerCustomer"),
    }
    startTransition(async () => {
      const result = discount
        ? await updateDiscountAction({ id: discount.id, ...fields })
        : await createDiscountAction({
            ...fields,
            kind,
            code: kind === "coupon" ? text("code").toUpperCase() : undefined,
          })
      if (result.ok) {
        toast.success("Discount saved")
        setErrors({})
      } else {
        setErrors(result.fieldErrors ?? {})
        toast.error(result.message)
      }
    })
  }

  const error = (name: string) =>
    errors[name] && (
      <span className="text-xs text-destructive">{errors[name]![0]}</span>
    )

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-sm border bg-card p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Name (staff only)
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            defaultValue={discount?.name}
            className={field}
          />
          {error("name")}
        </label>
        {!discount && (
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1">Type</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={kind === "coupon"}
                onChange={() => setKind("coupon")}
              />
              Coupon (customer enters a code)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={kind === "automatic"}
                onChange={() => setKind("automatic")}
              />
              Automatic (applies by itself)
            </label>
          </fieldset>
        )}
        {!discount && kind === "coupon" && (
          <label className="flex flex-col gap-1 text-sm">
            Code
            <input
              name="code"
              required
              pattern="[A-Za-z0-9_-]{3,32}"
              className={`${field} font-mono uppercase`}
            />
            <span className="text-xs text-muted-foreground">
              More single-use codes can be generated after saving.
            </span>
            {error("code")}
          </label>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="mb-1">Value</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={valueType === "percentage"}
              onChange={() => setValueType("percentage")}
            />
            Percentage
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={valueType === "fixed"}
              onChange={() => setValueType("fixed")}
            />
            Fixed amount
          </label>
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          {valueType === "percentage" ? "Percent off" : "Amount off (₹)"}
          <input
            name="value"
            type="number"
            required
            min={0.01}
            max={valueType === "percentage" ? 100 : undefined}
            step="0.01"
            key={valueType}
            defaultValue={
              discount && discount.valueType === valueType
                ? discount.value / 100
                : undefined
            }
            className={field}
          />
          {error("value")}
        </label>
        {valueType === "percentage" && (
          <label className="flex flex-col gap-1 text-sm">
            Cap (₹, optional)
            <input
              name="maxDiscount"
              type="number"
              min={1}
              step="1"
              defaultValue={
                discount?.maxDiscountPaise
                  ? discount.maxDiscountPaise / 100
                  : undefined
              }
              className={field}
            />
          </label>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Minimum order (₹)
          <input
            name="minOrder"
            type="number"
            min={0}
            step="1"
            defaultValue={discount ? discount.minOrderPaise / 100 : 0}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Starts (IST)
          <input
            name="startsAt"
            type="datetime-local"
            defaultValue={toLocal(discount?.startsAt ?? null)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Ends (IST, optional)
          <input
            name="endsAt"
            type="datetime-local"
            defaultValue={toLocal(discount?.endsAt ?? null)}
            className={field}
          />
          {error("endsAt")}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Total uses (optional)
          <input
            name="usageLimitTotal"
            type="number"
            min={1}
            defaultValue={discount?.usageLimitTotal ?? undefined}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Uses per customer (optional)
          <input
            name="usageLimitPerCustomer"
            type="number"
            min={1}
            defaultValue={discount?.usageLimitPerCustomer ?? undefined}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Priority (higher wins)
          <input
            name="priority"
            type="number"
            min={0}
            max={1000}
            defaultValue={discount?.priority ?? 0}
            className={field}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1 font-medium">Who and how</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="firstOrderOnly"
            defaultChecked={discount?.eligibility.firstOrderOnly}
          />
          First order only
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="phoneVerifiedOnly"
            defaultChecked={discount?.eligibility.phoneVerifiedOnly}
          />
          Verified mobile number only
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="combinable"
            defaultChecked={discount?.combinable}
          />
          Also applies to items already on sale
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">
          Applies to {targets.length === 0 && "(everything)"}
        </legend>
        <TargetGroup
          title="Categories"
          options={categories}
          isOn={(id) =>
            targets.some((t) => t.type === "category" && t.id === id)
          }
          onToggle={(id) => toggle("category", id)}
        />
        <TargetGroup
          title="Collections"
          options={collections}
          isOn={(id) =>
            targets.some((t) => t.type === "collection" && t.id === id)
          }
          onToggle={(id) => toggle("collection", id)}
        />
        {kept.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Also {kept.length} product or variant targets, kept as they are.
          </p>
        )}
      </fieldset>

      <Button
        type="submit"
        disabled={pending}
        className="self-start rounded-sm"
      >
        {pending ? "Saving…" : discount ? "Save changes" : "Create discount"}
      </Button>
    </form>
  )
}

function TargetGroup({
  title,
  options,
  isOn,
  onToggle,
}: {
  title: string
  options: Option[]
  isOn: (id: string) => boolean
  onToggle: (id: string) => void
}) {
  if (options.length === 0) return null
  return (
    <details className="rounded-sm border p-2">
      <summary className="cursor-pointer">
        {title} ({options.filter((o) => isOn(o.id)).length} chosen)
      </summary>
      <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isOn(option.id)}
              onChange={() => onToggle(option.id)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </details>
  )
}

"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { PhotoPicker } from "@/components/customer/photo-picker"
import { usePayment } from "@/components/payment/use-payment"
import { Button } from "@/components/ui/button"
import type { ExchangeableItem } from "@/features/exchanges"
import {
  cancelExchangeAction,
  requestExchangeAction,
  startExchangePaymentAction,
} from "@/features/exchanges/actions"
import { formatPaise } from "@/lib/money"

const REASONS = [
  ["too_small", "Too small"],
  ["too_large", "Too large"],
  ["colour", "Prefer another colour"],
  ["damaged", "Arrived damaged"],
  ["wrong_item", "Wrong item sent"],
  ["other", "Something else"],
] as const

const field = "h-11 w-full border border-input bg-card px-3 text-sm"

export function ExchangeForm({
  orderNumber,
  items,
}: {
  orderNumber: string
  items: ExchangeableItem[]
}) {
  const [itemId, setItemId] = useState(items[0]!.orderItemId)
  const item = items.find((i) => i.orderItemId === itemId)!
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("too_small")
  const [variantId, setVariantId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const sameAllowed = reason === "damaged" || reason === "wrong_item"
  const options = item.options.filter(
    (o) => sameAllowed || o.label !== item.variantLabel,
  )
  const option = options.find((o) => o.variantId === variantId)
  const difference = option ? option.differencePerUnitPaise * quantity : 0

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!option) return void toast.error("Choose the size or colour you want.")
    const note = String(new FormData(event.currentTarget).get("note") ?? "")
    startTransition(async () => {
      const result = await requestExchangeAction({
        orderNumber,
        orderItemId: itemId,
        variantId,
        quantity,
        reason,
        note: note || undefined,
        photoIds,
      })
      if (result.ok)
        toast.success(`Exchange ${result.exchangeNumber} requested`)
      else toast.error(result.message)
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 border bg-card p-4">
      <h3 className="font-semibold">Request an exchange</h3>
      <label className="flex flex-col gap-1 text-sm">
        Item
        <select
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value)
            setVariantId("")
            setQuantity(1)
          }}
          className={field}
        >
          {items.map((i) => (
            <option key={i.orderItemId} value={i.orderItemId}>
              {i.title} ({i.variantLabel})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Why are you exchanging it?
        <select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value as typeof reason)
            setVariantId("")
          }}
          className={field}
        >
          {REASONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">What would you like instead?</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <label
              key={o.variantId}
              className={`cursor-pointer border px-3 py-2 ${o.available < quantity ? "opacity-50" : ""} has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper`}
            >
              <input
                type="radio"
                name="variant"
                value={o.variantId}
                checked={variantId === o.variantId}
                disabled={o.available < quantity}
                onChange={() => setVariantId(o.variantId)}
                className="sr-only"
              />
              {o.label}
              {o.available < quantity && " (sold out)"}
            </label>
          ))}
        </div>
      </fieldset>
      {item.quantity > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          How many?
          <input
            type="number"
            min={1}
            max={item.quantity}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value) || 1)}
            className={`${field} w-24`}
          />
        </label>
      )}
      {option && (
        <p className="text-sm">
          {difference > 0
            ? `It costs ${formatPaise(difference)} more. You'll pay that after we approve.`
            : difference < 0
              ? `It costs ${formatPaise(-difference)} less. We'll add that to your Duis wallet once we receive your item.`
              : "Same price: nothing to pay, and pickup is free."}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Anything we should know? (optional)
        <textarea
          name="note"
          maxLength={500}
          rows={3}
          className="border border-input bg-card p-3 text-sm"
        />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        Photos (optional, helpful if it arrived damaged)
        <PhotoPicker onChange={setPhotoIds} />
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-none px-6"
      >
        {pending ? "Sending…" : "Request exchange"}
      </Button>
    </form>
  )
}

export function ExchangeActions({
  exchangeNumber,
  canCancel,
  canPay,
}: {
  exchangeNumber: string
  canCancel: boolean
  canPay: boolean
}) {
  const { pay, dialog } = usePayment()
  const [pending, startTransition] = useTransition()
  return (
    <span className="flex gap-2">
      {canPay && (
        <Button
          size="sm"
          disabled={pending}
          className="rounded-none"
          onClick={() =>
            startTransition(async () => {
              const started = await startExchangePaymentAction(exchangeNumber)
              if (!started.ok) return void toast.error(started.message)
              const outcome = await pay(started.payment)
              if (outcome === "confirmed") {
                toast.success("Paid. We're booking your pickup.")
                window.location.reload()
              } else if (outcome === "failed") {
                toast.error("The payment didn't go through. You can try again.")
              }
            })
          }
        >
          Pay difference
        </Button>
      )}
      {canCancel && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          className="rounded-none"
          onClick={() =>
            startTransition(async () => {
              const result = await cancelExchangeAction(exchangeNumber)
              if (result.ok) toast.success("Exchange cancelled")
              else toast.error(result.message)
            })
          }
        >
          Cancel
        </Button>
      )}
      {dialog}
    </span>
  )
}

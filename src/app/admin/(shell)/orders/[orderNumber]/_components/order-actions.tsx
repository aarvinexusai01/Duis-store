"use client"

import { useState, useTransition, type ReactNode } from "react"
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
  createShipmentsAction,
  refundOrderAction,
  staffCancelOrderAction,
  startProcessingAction,
} from "@/features/orders/admin-actions"
import { formatPaise } from "@/lib/money"

const field =
  "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm tabular-nums"

type Can = {
  startProcessing: boolean
  ship: boolean
  cancel: boolean
  refund: boolean
}

/** The order's main actions; each opens a dialog that asks for what it needs. */
export function OrderActions({
  orderNumber,
  can,
  refundable,
  defaultWeightGrams,
  hasLiveParcel,
}: {
  orderNumber: string
  can: Can
  refundable: { toSourcePaise: number; toWalletPaise: number } | null
  defaultWeightGrams: number
  hasLiveParcel: boolean
}) {
  const [open, setOpen] = useState<"ship" | "cancel" | "refund" | null>(null)
  const [pending, startTransition] = useTransition()
  const close = () => setOpen(null)

  const startPacking = () =>
    startTransition(async () => {
      const result = await startProcessingAction(orderNumber)
      if (result.ok) toast.success("Marked as being packed")
      else toast.error(result.message)
    })

  return (
    <>
      {can.startProcessing && (
        <Button
          variant="outline"
          className="rounded-sm"
          disabled={pending}
          onClick={startPacking}
        >
          Start packing
        </Button>
      )}
      {can.ship && (
        <Button className="rounded-sm" onClick={() => setOpen("ship")}>
          Book parcel
        </Button>
      )}
      {can.refund && (
        <Button
          variant="outline"
          className="rounded-sm"
          onClick={() => setOpen("refund")}
        >
          Refund
        </Button>
      )}
      {can.cancel && (
        <Button
          variant="outline"
          className="rounded-sm border-destructive/40 text-destructive"
          onClick={() => setOpen("cancel")}
        >
          Cancel order
        </Button>
      )}

      <Modal
        open={open === "ship"}
        onClose={close}
        title="Book parcel"
        description="Books the courier, gets the AWB and label, and asks for pickup."
      >
        <ShipForm
          orderNumber={orderNumber}
          defaultWeightGrams={defaultWeightGrams}
          onDone={close}
        />
      </Modal>
      <Modal
        open={open === "cancel"}
        onClose={close}
        title="Cancel order"
        description={
          hasLiveParcel
            ? "The parcel is cancelled with the courier first. Then the stock is returned and the customer is refunded."
            : "The stock is returned and the customer is refunded to how they paid."
        }
      >
        <CancelForm orderNumber={orderNumber} onDone={close} />
      </Modal>
      {refundable && (
        <Modal
          open={open === "refund"}
          onClose={close}
          title="Refund"
          description={`Up to ${formatPaise(refundable.toSourcePaise)} back to the original payment, or up to ${formatPaise(refundable.toWalletPaise)} to the wallet.`}
        >
          <RefundForm
            orderNumber={orderNumber}
            refundable={refundable}
            onDone={close}
          />
        </Modal>
      )}
    </>
  )
}

function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="bg-paper">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function ShipForm({
  orderNumber,
  defaultWeightGrams,
  onDone,
}: {
  orderNumber: string
  defaultWeightGrams: number
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const num = (name: string) => Number(form.get(name))
    startTransition(async () => {
      const result = await createShipmentsAction({
        orderNumbers: [orderNumber],
        weightGrams: num("weight"),
        lengthCm: num("length"),
        breadthCm: num("breadth"),
        heightCm: num("height"),
      })
      if (!result.ok) return void toast.error(result.message)
      const outcome = result.results[0]
      if (outcome?.ok) {
        toast.success("Parcel booked")
        onDone()
      } else {
        toast.error(
          `Booking didn't finish: ${outcome?.error ?? "unknown error"}. It will retry in the background.`,
        )
        onDone()
      }
    })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Packed weight (grams)
        <input
          name="weight"
          type="number"
          min={10}
          max={50000}
          required
          defaultValue={defaultWeightGrams}
          className={field}
        />
      </label>
      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="mb-1 text-sm">Box size (cm)</legend>
        {(
          [
            ["length", "Length", 30],
            ["breadth", "Breadth", 25],
            ["height", "Height", 5],
          ] as const
        ).map(([name, label, value]) => (
          <label key={name} className="flex flex-col gap-1 text-xs">
            {label}
            <input
              name={name}
              type="number"
              min={1}
              max={200}
              required
              defaultValue={value}
              className={field}
            />
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending} className="rounded-sm">
        {pending ? "Booking…" : "Book parcel"}
      </Button>
    </form>
  )
}

function CancelForm({
  orderNumber,
  onDone,
}: {
  orderNumber: string
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const reason = String(new FormData(event.currentTarget).get("reason"))
    startTransition(async () => {
      const result = await staffCancelOrderAction({ orderNumber, reason })
      if (result.ok) {
        toast.success("Order cancelled")
        onDone()
      } else toast.error(result.message)
    })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Reason (the customer sees that we cancelled; this stays internal)
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={300}
          rows={3}
          className="rounded-sm border border-input bg-card p-2 text-sm"
        />
      </label>
      <Button
        type="submit"
        variant="destructive"
        disabled={pending}
        className="rounded-sm"
      >
        {pending ? "Cancelling…" : "Cancel order"}
      </Button>
    </form>
  )
}

function RefundForm({
  orderNumber,
  refundable,
  onDone,
}: {
  orderNumber: string
  refundable: { toSourcePaise: number; toWalletPaise: number }
  onDone: () => void
}) {
  const [destination, setDestination] = useState<"source" | "wallet">(
    refundable.toSourcePaise > 0 ? "source" : "wallet",
  )
  // One key per dialog: a double click can't refund twice.
  const [key] = useState(() => crypto.randomUUID())
  const [pending, startTransition] = useTransition()
  const max =
    destination === "source"
      ? refundable.toSourcePaise
      : refundable.toWalletPaise
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await refundOrderAction({
        orderNumber,
        amountPaise: Math.round(Number(form.get("amount")) * 100),
        destination,
        reason: String(form.get("reason")),
        idempotencyKey: key,
      })
      if (result.ok) {
        toast.success(
          destination === "source"
            ? "Refund sent to the payment gateway"
            : "Refunded to the wallet",
        )
        onDone()
      } else toast.error(result.message)
    })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1">Refund to</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="destination"
            checked={destination === "source"}
            disabled={refundable.toSourcePaise === 0}
            onChange={() => setDestination("source")}
          />
          Original payment (up to {formatPaise(refundable.toSourcePaise)})
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="destination"
            checked={destination === "wallet"}
            onChange={() => setDestination("wallet")}
          />
          Duis wallet, never expires (up to{" "}
          {formatPaise(refundable.toWalletPaise)})
        </label>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        Amount (₹)
        <input
          name="amount"
          type="number"
          min={1}
          max={max / 100}
          step="0.01"
          required
          defaultValue={max / 100}
          key={destination}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Reason
        <input
          name="reason"
          required
          minLength={3}
          maxLength={300}
          className={field}
        />
      </label>
      <Button type="submit" disabled={pending} className="rounded-sm">
        {pending ? "Refunding…" : "Refund"}
      </Button>
    </form>
  )
}

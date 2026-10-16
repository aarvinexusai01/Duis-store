"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AdminOrderDetail } from "@/features/orders"
import { updateShippingAddressAction } from "@/features/orders/admin-actions"

type ShippingAddressSnapshot = AdminOrderDetail["shippingAddress"]

const field = "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm"

/** Corrects the delivery address before booking; the state can't change. */
export function AddressEditor({
  orderNumber,
  address,
}: {
  orderNumber: string
  address: ShippingAddressSnapshot
}) {
  const [open, setOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "")
    startTransition(async () => {
      const result = await updateShippingAddressAction({
        orderNumber,
        address: {
          fullName: text("fullName"),
          phone: text("phone"),
          line1: text("line1"),
          line2: text("line2"),
          landmark: text("landmark"),
          city: text("city"),
          postalCode: text("postalCode"),
          stateCode: address.stateCode ?? undefined,
          countryCode: "IN",
        },
      })
      if (result.ok) {
        toast.success("Address updated")
        setOpen(false)
      } else {
        setErrors(result.fieldErrors ?? {})
        toast.error(result.message)
      }
    })
  }
  const input = (
    name: keyof ShippingAddressSnapshot,
    label: string,
    required = true,
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        name={name}
        required={required}
        defaultValue={(address[name] as string | null) ?? ""}
        aria-invalid={Boolean(errors[name])}
        className={field}
      />
      {errors[name] && (
        <span className="text-xs text-destructive">{errors[name]![0]}</span>
      )}
    </label>
  )
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="h-7"
      >
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-paper">
          <DialogHeader>
            <DialogTitle>Delivery address</DialogTitle>
            <DialogDescription>
              The state stays {address.stateCode}: a different state changes the
              GST, so that needs a new order.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            {input("fullName", "Name")}
            {input("phone", "Mobile")}
            <div className="sm:col-span-2">{input("line1", "Address")}</div>
            {input("line2", "Address line 2", false)}
            {input("landmark", "Landmark", false)}
            {input("city", "City")}
            {input("postalCode", "PIN code")}
            <Button
              type="submit"
              disabled={pending}
              className="rounded-sm sm:col-span-2"
            >
              {pending ? "Saving…" : "Save address"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

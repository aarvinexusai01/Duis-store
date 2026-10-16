"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { usePayment } from "@/components/payment/use-payment"
import { Button } from "@/components/ui/button"
import { startPaymentAction } from "@/features/checkout/actions"
import { cancelOrderAction } from "@/features/orders/actions"

export function OrderActions({
  orderNumber,
  canCancel,
  canPay,
}: {
  orderNumber: string
  canCancel: boolean
  canPay: boolean
}) {
  const router = useRouter()
  const { pay, dialog } = usePayment()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  const payNow = () =>
    startTransition(async () => {
      const started = await startPaymentAction(orderNumber)
      if (!started.ok) {
        toast.error(started.message)
        return
      }
      try {
        const outcome = await pay(started.payment)
        if (outcome === "confirmed" || outcome === "pending") {
          router.push(`/checkout/success/${orderNumber}` as Route)
        } else if (outcome === "failed") {
          toast.error("The payment didn't go through. You can try again.")
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Payment failed.")
      }
    })

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelOrderAction(orderNumber)
      setConfirming(false)
      if (result.ok) toast.success("Order cancelled. Any refund is on its way.")
      else toast.error(result.message)
    })

  return (
    <div className="flex flex-wrap gap-2">
      {canPay && (
        <Button
          onClick={payNow}
          disabled={pending}
          className="h-10 rounded-none px-5"
        >
          Pay now
        </Button>
      )}
      {canCancel &&
        (confirming ? (
          <>
            <Button
              variant="destructive"
              onClick={cancel}
              disabled={pending}
              className="h-10 rounded-none"
            >
              Yes, cancel order
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirming(false)}
              className="h-10 rounded-none"
            >
              Keep it
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            onClick={() => setConfirming(true)}
            className="h-10 rounded-none"
          >
            Cancel order
          </Button>
        ))}
      {dialog}
    </div>
  )
}

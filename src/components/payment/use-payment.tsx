"use client"

import { useCallback, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatPaise } from "@/lib/money"

import {
  simulatePaymentAction,
  verifyPaymentAction,
} from "@/features/checkout/actions"
import type { PaymentOptions } from "@/features/checkout"

export type PaymentOutcome =
  "confirmed" | "pending" | "failed" | "cancelled" | "dismissed"

type RazorpayResponse = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

type RazorpayInstance = {
  open(): void
  on(event: string, cb: (r: unknown) => void): void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

const CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js"

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = CHECKOUT_JS
    script.async = true
    script.onload = () => resolve()
    script.onerror = () =>
      reject(
        new Error("Couldn't load the payment window. Check your connection."),
      )
    document.body.appendChild(script)
  })
}

/**
 * Opens the gateway's checkout and reports what happened. The server
 * decides the outcome (signature + gateway check), never the browser.
 */
export function usePayment(): {
  pay: (options: PaymentOptions) => Promise<PaymentOutcome>
  dialog: ReactNode
} {
  const [fake, setFake] = useState<{
    options: PaymentOptions
    resolve: (outcome: "captured" | "failed" | null) => void
  } | null>(null)

  const verify = useCallback(
    async (
      options: PaymentOptions,
      paymentId: string,
      signature: string,
    ): Promise<PaymentOutcome> => {
      const result = await verifyPaymentAction({
        orderNumber: options.orderNumber,
        providerOrderId: options.providerOrderId,
        providerPaymentId: paymentId,
        signature,
      })
      if (!result.ok) throw new Error(result.message)
      return result.status
    },
    [],
  )

  const pay = useCallback(
    async (options: PaymentOptions): Promise<PaymentOutcome> => {
      if (options.provider === "fake") {
        const outcome = await new Promise<"captured" | "failed" | null>(
          (resolve) => setFake({ options, resolve }),
        )
        setFake(null)
        if (!outcome) return "dismissed"
        const simulated = await simulatePaymentAction({
          orderNumber: options.orderNumber,
          providerOrderId: options.providerOrderId,
          outcome,
        })
        if (!simulated.ok) throw new Error(simulated.message)
        return verify(options, simulated.paymentId, simulated.signature)
      }

      await loadRazorpay()
      return new Promise<PaymentOutcome>((resolve, reject) => {
        const checkout = new window.Razorpay!({
          key: options.key,
          amount: options.amountPaise,
          currency: options.currency,
          order_id: options.providerOrderId,
          name: "Duis",
          description: `Order ${options.orderNumber}`,
          prefill: options.prefill,
          theme: { color: "#111111" },
          handler: (response: RazorpayResponse) => {
            verify(
              options,
              response.razorpay_payment_id,
              response.razorpay_signature,
            ).then(resolve, reject)
          },
          modal: { ondismiss: () => resolve("dismissed") },
        })
        checkout.open()
      })
    },
    [verify],
  )

  const dialog = (
    <Dialog
      open={fake !== null}
      onOpenChange={(open) => !open && fake?.resolve(null)}
    >
      <DialogContent className="bg-paper">
        <DialogHeader>
          <DialogTitle>Simulated payment</DialogTitle>
          <DialogDescription>
            Development mode: no real gateway is configured, so nothing is
            charged. Choose what the payment should do.
          </DialogDescription>
        </DialogHeader>
        {fake && (
          <p className="text-2xl font-semibold">
            {formatPaise(fake.options.amountPaise)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            className="rounded-none"
            onClick={() => fake?.resolve("captured")}
          >
            Pay successfully
          </Button>
          <Button
            variant="outline"
            className="rounded-none"
            onClick={() => fake?.resolve("failed")}
          >
            Fail the payment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  return { pay, dialog }
}

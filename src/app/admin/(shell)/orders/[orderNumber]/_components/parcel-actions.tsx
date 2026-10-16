"use client"

import { useTransition } from "react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  cancelShipmentAction,
  retryShipmentAction,
  simulateTrackingAction,
} from "@/features/orders/admin-actions"
import { SHIPMENT_STATUS_LABEL } from "@/lib/order-status"
import { cn } from "@/lib/utils"

/** Label, retry and cancel for one parcel; scan simulation with the demo courier. */
export function ParcelActions({
  shipmentId,
  status,
  hasLabel,
  canSimulate,
}: {
  shipmentId: string
  status: string
  hasLabel: boolean
  canSimulate: boolean
}) {
  const [pending, startTransition] = useTransition()
  const act = (
    work: () => Promise<{ ok: boolean; message?: string }>,
    done: string,
  ) =>
    startTransition(async () => {
      const result = await work()
      if (result.ok) toast.success(done)
      else toast.error(result.message ?? "Something went wrong.")
    })
  const open = ["pending", "ready_to_ship"].includes(status)
  const moving = [
    "ready_to_ship",
    "picked_up",
    "in_transit",
    "out_for_delivery",
    "undelivered",
    "rto_initiated",
  ].includes(status)

  return (
    <div className="flex flex-wrap gap-2">
      {hasLabel && (
        <a
          href={`/admin/shipments/${shipmentId}/label`}
          target="_blank"
          rel="noreferrer"
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "rounded-sm",
          )}
        >
          Label (PDF)
        </a>
      )}
      {status === "pending" && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-sm"
          disabled={pending}
          onClick={() =>
            act(() => retryShipmentAction(shipmentId), "Parcel booked")
          }
        >
          Retry booking
        </Button>
      )}
      {open && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-sm border-destructive/40 text-destructive"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Cancel this parcel with the courier?")) return
            act(() => cancelShipmentAction(shipmentId), "Parcel cancelled")
          }}
        >
          Cancel parcel
        </Button>
      )}
      {canSimulate && moving && (
        <span className="flex flex-wrap gap-2 rounded-sm border border-dashed p-1">
          <span className="self-center px-1 text-xs text-muted-foreground">
            Demo scans:
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              act(
                () => simulateTrackingAction({ shipmentId, outcome: "next" }),
                "Scan added",
              )
            }
          >
            Next scan
          </Button>
          {status === "out_for_delivery" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                act(
                  () =>
                    simulateTrackingAction({
                      shipmentId,
                      outcome: "undelivered",
                    }),
                  SHIPMENT_STATUS_LABEL.undelivered!,
                )
              }
            >
              Delivery failed
            </Button>
          )}
          {status !== "ready_to_ship" && status !== "rto_initiated" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                act(
                  () => simulateTrackingAction({ shipmentId, outcome: "rto" }),
                  "Return to origin started",
                )
              }
            >
              Return to us
            </Button>
          )}
        </span>
      )}
    </div>
  )
}

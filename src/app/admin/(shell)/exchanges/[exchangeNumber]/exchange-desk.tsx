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
import type { ExchangeStatus } from "@/features/exchanges"
import {
  approveExchangeAction,
  failExchangeQcAction,
  markExchangeReceivedAction,
  passExchangeQcAction,
  rejectExchangeAction,
} from "@/features/exchanges/actions"

type Result = { ok: boolean; message?: string }

/** The next steps for an exchange, for staff who may take them. */
export function ExchangeDesk({
  exchangeNumber,
  status,
  can,
}: {
  exchangeNumber: string
  status: ExchangeStatus
  can: { decide: boolean; process: boolean }
}) {
  const [asking, setAsking] = useState<"reject" | "fail" | null>(null)
  const [pending, startTransition] = useTransition()
  const act = (work: () => Promise<Result>, done: string) =>
    startTransition(async () => {
      const result = await work()
      if (result.ok) {
        toast.success(done)
        setAsking(null)
      } else toast.error(result.message ?? "Something went wrong.")
    })
  const arrived = ["pickup_scheduled", "picked_up", "received"].includes(status)

  return (
    <>
      {can.decide && status === "requested" && (
        <Button
          className="rounded-sm"
          disabled={pending}
          onClick={() =>
            act(() => approveExchangeAction({ exchangeNumber }), "Approved")
          }
        >
          Approve
        </Button>
      )}
      {can.decide && ["requested", "awaiting_payment"].includes(status) && (
        <Button
          variant="outline"
          className="rounded-sm border-destructive/40 text-destructive"
          disabled={pending}
          onClick={() => setAsking("reject")}
        >
          Reject
        </Button>
      )}
      {can.process && ["pickup_scheduled", "picked_up"].includes(status) && (
        <Button
          variant="outline"
          className="rounded-sm"
          disabled={pending}
          onClick={() =>
            act(
              () => markExchangeReceivedAction(exchangeNumber),
              "Marked received",
            )
          }
        >
          Mark received
        </Button>
      )}
      {can.process && arrived && (
        <>
          <Button
            className="rounded-sm"
            disabled={pending}
            onClick={() =>
              act(
                () => passExchangeQcAction({ exchangeNumber }),
                "QC passed: replacement being booked",
              )
            }
          >
            QC passed
          </Button>
          <Button
            variant="outline"
            className="rounded-sm border-destructive/40 text-destructive"
            disabled={pending}
            onClick={() => setAsking("fail")}
          >
            QC failed
          </Button>
        </>
      )}
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
      >
        <DialogContent className="bg-paper">
          <DialogHeader>
            <DialogTitle>
              {asking === "reject" ? "Reject this exchange" : "QC failed"}
            </DialogTitle>
            <DialogDescription>
              {asking === "reject"
                ? "The customer is told why, and the held item goes back on sale."
                : "The item is sent back to the customer at our cost, with no replacement or credit; any difference paid is refunded. The customer is told why."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const note = String(new FormData(event.currentTarget).get("note"))
              act(
                () =>
                  asking === "reject"
                    ? rejectExchangeAction({ exchangeNumber, note })
                    : failExchangeQcAction({ exchangeNumber, note }),
                asking === "reject" ? "Rejected" : "Marked QC failed",
              )
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              Reason (sent to the customer)
              <textarea
                name="note"
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
              {asking === "reject" ? "Reject" : "Confirm QC failed"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

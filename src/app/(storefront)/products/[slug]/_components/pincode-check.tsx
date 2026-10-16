"use client"

import { TruckIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { Serviceability } from "@/features/shipping"

type Result =
  | { status: "idle" | "loading" }
  | { status: "done"; pincode: string; data: Serviceability }
  | { status: "error"; message: string }

/** India PIN-code check; the answer comes from the courier provider. */
/** `codAdvance` is "₹100" or "10%", or null when partial COD is off. */
export function PincodeCheck({ codAdvance }: { codAdvance: string | null }) {
  const [pincode, setPincode] = useState("")
  const [result, setResult] = useState<Result>({ status: "idle" })

  const check = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      setResult({ status: "error", message: "Enter a valid 6-digit PIN code." })
      return
    }
    setResult({ status: "loading" })
    try {
      const response = await fetch(`/api/serviceability?pincode=${pincode}`)
      const body = await response.json()
      setResult(
        response.ok
          ? { status: "done", pincode, data: body as Serviceability }
          : {
              status: "error",
              message: body?.error?.message ?? "Couldn't check right now.",
            },
      )
    } catch {
      setResult({
        status: "error",
        message: "Couldn't check right now. Try again.",
      })
    }
  }

  return (
    <div className="border p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <TruckIcon className="size-4" aria-hidden />
        Check delivery
      </p>
      <form onSubmit={check} className="mt-3 flex gap-2">
        <label htmlFor="pdp-pincode" className="sr-only">
          PIN code
        </label>
        <input
          id="pdp-pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          placeholder="Enter PIN code"
          value={pincode}
          onChange={(event) =>
            setPincode(event.target.value.replace(/\D/g, ""))
          }
          className="h-10 min-w-0 flex-1 border border-input bg-card px-3 text-sm"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={result.status === "loading"}
          className="h-10 rounded-none px-4"
        >
          Check
        </Button>
      </form>
      <div role="status" className="mt-2 text-sm">
        {result.status === "error" && (
          <p className="text-destructive">{result.message}</p>
        )}
        {result.status === "done" &&
          (result.data.serviceable ? (
            <ul className="space-y-1">
              {result.data.eddMinDays !== null &&
                result.data.eddMaxDays !== null && (
                  <li>
                    Delivery to {result.pincode} in {result.data.eddMinDays}–
                    {result.data.eddMaxDays} days after dispatch.
                  </li>
                )}
              <li className="text-muted-foreground">
                {result.data.codAvailable && codAdvance
                  ? `Cash on delivery available (${codAdvance} paid online).`
                  : "Prepaid orders only for this PIN code."}
              </li>
            </ul>
          ) : (
            <p className="text-destructive">
              Sorry, we don&apos;t deliver to {result.pincode} yet.
            </p>
          ))}
      </div>
    </div>
  )
}

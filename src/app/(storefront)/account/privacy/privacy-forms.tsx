"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ConsentFields } from "@/features/privacy"
import {
  setNomineeAction,
  withdrawConsentAction,
} from "@/features/privacy/actions"
import type { NoticeLanguage } from "@/lib/privacy"

type Withdrawable = Parameters<typeof withdrawConsentAction>[0]

// What happens, said before it happens.
const EFFECT: Record<Withdrawable, string> = {
  marketing: "We'll stop sending you marketing emails.",
  marketing_whatsapp: "We'll stop sending you offers on WhatsApp.",
  whatsapp_updates: "We'll stop sending order updates on WhatsApp.",
  stock_alert: "Your waiting back-in-stock alerts will be removed.",
  review: "Your reviews and their photos will be taken off the shop.",
  address: "All your saved addresses will be removed.",
}

export function WithdrawButton({ purpose }: { purpose: Withdrawable }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="rounded-none"
        onClick={() => setConfirming(true)}
      >
        Withdraw
      </Button>
    )
  }
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <p className="text-xs">{EFFECT[purpose]}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          className="rounded-none"
          onClick={() =>
            startTransition(async () => {
              const result = await withdrawConsentAction(purpose)
              if (result.ok) toast.success("Consent withdrawn")
              else toast.error(result.message)
              setConfirming(false)
            })
          }
        >
          Yes, withdraw
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-none"
          onClick={() => setConfirming(false)}
        >
          Keep it
        </Button>
      </div>
    </div>
  )
}

export function NomineeForm({
  nominee,
}: {
  nominee: { name: string; contact: string } | null
}) {
  const [pending, startTransition] = useTransition()
  const [consent, setConsent] = useState<NoticeLanguage | null>(null)
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})

  if (nominee) {
    return (
      <div className="flex flex-col gap-2">
        <p>
          <span className="font-medium">{nominee.name}</span>, {nominee.contact}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          className="self-start rounded-none"
          onClick={() =>
            startTransition(async () => {
              const result = await setNomineeAction({ action: "remove" })
              if (result.ok) toast.success("Nominee removed")
              else toast.error(result.message)
            })
          }
        >
          Remove nominee
        </Button>
      </div>
    )
  }
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!consent) return void toast.error("Please tick the box to continue.")
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await setNomineeAction({
        action: "save",
        name: String(form.get("name") ?? ""),
        contact: String(form.get("contact") ?? ""),
        consent: true,
        consentLanguage: consent,
      })
      if (result.ok) toast.success("Nominee saved")
      else {
        setErrors(result.fieldErrors ?? {})
        toast.error(result.message)
      }
    })
  }
  const field = "h-10 max-w-sm border border-input bg-paper px-3"
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        Their name
        <input name="name" required maxLength={100} className={field} />
        {errors.name && (
          <span className="text-destructive">{errors.name[0]}</span>
        )}
      </label>
      <label className="flex flex-col gap-1">
        Their email or phone number
        <input name="contact" required maxLength={200} className={field} />
        {errors.contact && (
          <span className="text-destructive">{errors.contact[0]}</span>
        )}
      </label>
      <ConsentFields
        purposes={["nominee"]}
        onChange={(ticked, language) => setConsent(ticked ? language : null)}
      />
      <Button
        type="submit"
        disabled={pending}
        className="self-start rounded-none"
      >
        {pending ? "Saving…" : "Save nominee"}
      </Button>
    </form>
  )
}

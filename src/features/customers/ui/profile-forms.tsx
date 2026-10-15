"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

import {
  saveConsentAction,
  saveProfileAction,
  setDeletionRequestAction,
} from "../actions"

export function ProfileForm({ name }: { name: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")
  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const value = String(
          new FormData(event.currentTarget).get("name") ?? "",
        )
        startTransition(async () => {
          const result = await saveProfileAction({ name: value })
          if (result.ok) {
            setError("")
            toast.success("Name updated")
          } else setError(result.fieldErrors?.name?.[0] ?? result.message)
        })
      }}
    >
      <label htmlFor="profile-name" className="text-sm font-medium">
        Name
      </label>
      <div className="flex gap-2">
        <input
          id="profile-name"
          name="name"
          defaultValue={name}
          autoComplete="name"
          aria-invalid={error ? true : undefined}
          className="h-11 min-w-0 flex-1 border border-input bg-card px-3 text-base sm:text-sm"
        />
        <Button
          type="submit"
          disabled={pending}
          className="h-11 rounded-none px-5"
        >
          Save
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

export function ConsentForm({
  marketingEmail,
  marketingWhatsapp,
}: {
  marketingEmail: boolean
  marketingWhatsapp: boolean
}) {
  const [values, setValues] = useState({ marketingEmail, marketingWhatsapp })
  const [pending, startTransition] = useTransition()

  const toggle = (key: keyof typeof values, on: boolean) => {
    const next = { ...values, [key]: on }
    setValues(next)
    startTransition(async () => {
      const result = await saveConsentAction(next)
      if (result.ok) toast.success("Preferences saved")
      else {
        setValues(values)
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      {(
        [
          ["marketingEmail", "Offers and drops by email"],
          ["marketingWhatsapp", "Offers and drops on WhatsApp"],
        ] as const
      ).map(([key, label]) => (
        <label
          key={key}
          className="flex items-center justify-between gap-4 text-sm"
        >
          {label}
          <Switch
            checked={values[key]}
            disabled={pending}
            onCheckedChange={(checked) => toggle(key, checked)}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        Order updates are always sent; these only cover marketing. You can
        change them any time.
      </p>
    </div>
  )
}

export function DeletionRequest({
  requestedAt,
}: {
  requestedAt: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const set = (requested: boolean) =>
    startTransition(async () => {
      const result = await setDeletionRequestAction(requested)
      setConfirming(false)
      if (!result.ok) toast.error(result.message)
    })

  if (requestedAt) {
    return (
      <div className="flex max-w-md flex-col gap-3 text-sm">
        <p>
          You asked us to delete your account on{" "}
          {new Date(requestedAt).toLocaleDateString("en-IN", {
            dateStyle: "long",
          })}
          . Our team will complete it and email you; orders we must keep by law
          are retained only as long as required.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          className="h-10 w-fit rounded-none"
          onClick={() => set(false)}
        >
          Cancel the request
        </Button>
      </div>
    )
  }
  return (
    <div className="flex max-w-md flex-col gap-3 text-sm">
      <p>Ask us to delete your account and personal data.</p>
      {confirming ? (
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={pending}
            className="h-10 rounded-none"
            onClick={() => set(true)}
          >
            Yes, request deletion
          </Button>
          <Button
            variant="ghost"
            className="h-10 rounded-none"
            onClick={() => setConfirming(false)}
          >
            Keep my account
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="h-10 w-fit rounded-none"
          onClick={() => setConfirming(true)}
        >
          Request account deletion
        </Button>
      )}
    </div>
  )
}
